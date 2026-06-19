import { describe, expect, it } from 'vitest';
import { extractHeadings, fromMongo, parse, parseCitations, parseRelations, serialize, serializeRelations } from './index.js';

const samples = Array.from({ length: 10 }, (_, index) => `---
type: REGULATION
title: Sample ${index}
tags: [hr, policy]
custom_${index}: preserved
---
Intro ${index}

# Facts
- Fact ${index}

# Relations
- (Employee ${index}) -[receives]-> (Leave ${index}) {strength: 0.9, ref: /hr/leave.md}

# Citations
1. [Source](https://example.com/${index})
`);

describe('parse and serialize', () => {
  it('roundtrips frontmatter, body headings, and relations for sample documents', () => {
    for (const sample of samples) {
      const reparsed = parse(serialize(parse(sample)));
      const original = parse(sample);

      expect(reparsed.frontmatter).toEqual(original.frontmatter);
      expect(extractHeadings(reparsed.body)).toEqual(extractHeadings(original.body));
      expect(parseRelations(reparsed.body)).toEqual(parseRelations(original.body));
      expect(parseCitations(reparsed.body)).toHaveLength(1);
    }
  });

  it('parses and serializes relation triples with optional options', () => {
    const body = `# Relations
- (A) -[related_to]-> (B)
- (C) -[owns]-> (D) {strength: 0.75, ref: /c/d.md}
`;

    expect(parseRelations(body)).toEqual([
      { subject: 'A', predicate: 'related_to', object: 'B' },
      { subject: 'C', predicate: 'owns', object: 'D', strength: 0.75, ref: '/c/d.md' },
    ]);
    expect(serializeRelations(parseRelations(body))).toContain('(C) -[owns]-> (D) {strength: 0.75, ref: /c/d.md}');
  });

  it('converts Mongo documents into valid WKF documents', () => {
    const doc = fromMongo({
      title: 'Annual Leave',
      slug: 'hr/annual-leave',
      status: 'PUBLISHED',
      contentMarkdown: 'Policy body',
      sourceRefs: [{ ref: 'https://example.com/source', note: 'official' }],
    });

    expect(doc.frontmatter).toMatchObject({
      type: 'ENTITY',
      title: 'Annual Leave',
      slug: 'hr/annual-leave',
      resource: 'wekiflow://hr/annual-leave',
      status: 'PUBLISHED',
    });
    expect(parse(serialize(doc)).body).toContain('# Citations');
  });

  it('accepts UTF-8 BOM before frontmatter', () => {
    expect(parse('\uFEFF---\ntype: POLICY\n---\nBody').frontmatter.type).toBe('POLICY');
  });

  it('does not duplicate an existing citations heading when adapting Mongo documents', () => {
    const doc = fromMongo({
      title: 'Existing Citations',
      contentMarkdown: 'Body\n\n# Citations\n1. Existing source',
      sourceRefs: [{ ref: 'https://example.com/source' }],
    });

    expect(doc.body.match(/^# Citations$/gm)).toHaveLength(1);
    expect(doc.body).toContain('2. [Source 2](https://example.com/source)');
  });
});
