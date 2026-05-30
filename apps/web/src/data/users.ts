import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserBody, UserRole } from '@wf/shared';
import * as api from '../api/client.js';

const USERS_KEY = ['users'] as const;

export function useUsers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: api.listUsers });
}

export function useUserMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: USERS_KEY });
  const create = useMutation({ mutationFn: (body: CreateUserBody) => api.createUser(body), onSuccess: invalidate });
  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => api.updateUserRole(id, role),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteUser(id), onSuccess: invalidate });
  return { create, updateRole, remove };
}
