import type { FastifyPluginAsync } from 'fastify';
import * as notesService from '../services/notes.js';
import * as attachmentsService from '../services/attachments.js';
import { ValidationError } from '../core/errors.js';
import { serializeNote } from '../core/serialize.js';
import { parseTags } from '../services/notes.js';

export const noteRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/notes?project_id=&tag=&q=&include_archived=
  fastify.get('/', async (request) => {
    const q = request.query as Record<string, string>;
    const notes = await notesService.listNotes({
      projectId: q.project_id !== undefined ? q.project_id || null : undefined,
      tag: q.tag,
      q: q.q,
      includeArchived: q.include_archived === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return notes.map(serializeNote);
  });

  // GET /api/notes/tags?project_id= —— 标签聚合
  fastify.get('/tags', async (request) => {
    const q = request.query as Record<string, string>;
    return notesService.listNoteTags(q.project_id !== undefined ? q.project_id || null : undefined);
  });

  // POST /api/notes
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      project_id?: string | null;
      content?: string;
      tags?: string[];
      is_archived?: boolean;
      attachment_ids?: string[];
    };
    if (!body?.content?.trim()) throw new ValidationError('content 不能为空');
    const note = await notesService.createNote({
      projectId: body.project_id,
      content: body.content,
      tags: body.tags,
      isArchived: body.is_archived,
    });
    if (body.attachment_ids?.length) {
      await attachmentsService.linkMany(body.attachment_ids, 'note', note.id);
    }
    reply.code(201);
    return serializeNote({ ...note, tagList: parseTags(note.tags) });
  });

  // GET /api/notes/:noteId
  fastify.get('/:noteId', async (request) => {
    const { noteId } = request.params as { noteId: string };
    const note = await notesService.getNote(noteId);
    return serializeNote({ ...note, tagList: parseTags(note.tags) });
  });

  // PATCH /api/notes/:noteId
  fastify.patch('/:noteId', async (request) => {
    const { noteId } = request.params as { noteId: string };
    const body = request.body as {
      content?: string;
      tags?: string[];
      is_archived?: boolean;
      project_id?: string | null;
      pinned?: boolean;
    };
    const note = await notesService.updateNote(noteId, {
      content: body.content,
      tags: body.tags,
      isArchived: body.is_archived,
      projectId: body.project_id,
      pinned: body.pinned,
    });
    return serializeNote({ ...note, tagList: parseTags(note.tags) });
  });

  // DELETE /api/notes/:noteId
  fastify.delete('/:noteId', async (request, reply) => {
    const { noteId } = request.params as { noteId: string };
    await notesService.deleteNote(noteId);
    reply.code(204);
    return null;
  });
};
