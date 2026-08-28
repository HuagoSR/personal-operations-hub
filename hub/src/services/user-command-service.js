'use strict';
const { tx } = require('./tx');
const { BadRequestError } = require('../domain/errors');
const { insertUserCommand, findUserCommand, markConverted } = require('../domain/user-command');
const { findOrCreateGlobalConversation, insertMessage } = require('../domain/conversation');
const { insertCandidateWithApproval } = require('./candidate-service');

function createUserCommand(db, { text, projectId, actor: creator, ttlMs }) {
  if (!text || !String(text).trim()) throw new BadRequestError('command text is required');
  return tx(db, () => {
    const conv = findOrCreateGlobalConversation(db);
    const cmdId = insertUserCommand(db, {
      conversationId: conv.id, text: String(text).trim(),
      projectId: projectId || null, actorType: creator.actorType, actorId: creator.actorId,
    });
    insertMessage(db, {
      conversationId: conv.id, role: 'USER', kind: 'USER_COMMAND', content: String(text).trim(),
      refType: 'command', refId: cmdId, actorType: creator.actorType, actorId: creator.actorId,
    });
    const { candidateId, approvalId } = insertCandidateWithApproval(db, {
      originType: 'USER_COMMAND', originId: `cmd-${cmdId}`,
      title: String(text).trim().length > 80 ? String(text).trim().slice(0, 80) + '…' : String(text).trim(),
      description: String(text).trim(),
      projectId: projectId || null,
      reason: 'created from user command',
      creator,
      ttlMs,
    });
    markConverted(db, cmdId, candidateId);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'STATUS',
      content: `已创建任务候选 #${candidateId}，等待批准`,
      refType: 'candidate', refId: candidateId, actorType: creator.actorType, actorId: creator.actorId,
    });
    return { commandId: cmdId, candidateId, approvalId };
  });
}

module.exports = { createUserCommand };
