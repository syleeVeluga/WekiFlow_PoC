import type { Db, ObjectId } from 'mongodb';
import { normalizeEntityName, type DocumentDTO, type Triplet } from '@wf/shared';

export function createDocumentsRepo(db: Db) {
  const collection = db.collection('documents');

  return {
    async get(id: ObjectId) {
      return collection.findOne({ _id: id });
    },
    async setDraft(id: ObjectId, draftMarkdown: string) {
      await collection.updateOne(
        { _id: id },
        {
          $set: {
            draftMarkdown,
            status: 'REVIEW',
            updatedAt: new Date(),
          },
        },
      );
    },
  };
}

export function createJobsRepo(db: Db) {
  const collection = db.collection<{
    bullJobId: string;
    agentSteps?: Array<{ tool: string; args: unknown; result?: unknown; createdAt: Date }>;
  }>('jobs');

  return {
    async appendAgentStep(jobId: string, step: { tool: string; args: unknown; result?: unknown }) {
      await collection.updateOne(
        { bullJobId: jobId },
        {
          $setOnInsert: { createdAt: new Date() },
          $set: { updatedAt: new Date() },
          $push: { agentSteps: { ...step, createdAt: new Date() } },
        },
        { upsert: true },
      );
    },
  };
}

export function createSandboxRunsRepo(db: Db) {
  const collection = db.collection('sandbox_runs');

  return {
    async record(run: {
      jobId: string;
      image: string;
      command: string[];
      stdout: string;
      stderr: string;
      exitCode: number;
      durationMs: number;
      mounts: Array<{ source: string; target: string; ro: boolean }>;
    }) {
      await collection.insertOne({ ...run, createdAt: new Date() });
    },
  };
}

export async function upsertTriplets(db: Db, triplets: Triplet[], sourceDocId: string): Promise<void> {
  for (const triplet of triplets) {
    const subject = await db.collection('kg_nodes').findOneAndUpdate(
      { normalizedName: normalizeEntityName(triplet.subject) },
      {
        $setOnInsert: {
          name: triplet.subject,
          normalizedName: normalizeEntityName(triplet.subject),
          type: triplet.subjectType,
          createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
        $addToSet: {
          aliases: triplet.subject,
          descriptions: { text: triplet.subject, sourceDocId },
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const object = await db.collection('kg_nodes').findOneAndUpdate(
      { normalizedName: normalizeEntityName(triplet.object) },
      {
        $setOnInsert: {
          name: triplet.object,
          normalizedName: normalizeEntityName(triplet.object),
          type: triplet.objectType,
          createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
        $addToSet: {
          aliases: triplet.object,
          descriptions: { text: triplet.object, sourceDocId },
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    await db.collection('kg_edges').updateOne(
      {
        subjectId: subject?._id,
        predicate: triplet.predicate,
        objectId: object?._id,
      },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: { updatedAt: new Date() },
        $max: { strength: triplet.strength },
        $addToSet: {
          sourceDocIds: sourceDocId,
          descriptions: {
            text: `${triplet.subject} ${triplet.predicate} ${triplet.object}`,
            sourceDocId,
          },
        },
      },
      { upsert: true },
    );
  }
}

export function toDocumentDTO(document: DocumentDTO): DocumentDTO {
  return document;
}
