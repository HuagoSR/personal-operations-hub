'use strict';
const { tx } = require('./tx');
const { findOrCreateGlobalConversation, findConversation, insertConversation } = require('../domain/conversation');
const { findProjectByName, findProject, insertProject } = require('../domain/project');

function ensureSystemEntities(db) {
  return tx(db, () => {
    const globalConversation = findOrCreateGlobalConversation(db);
    let hubProject = findProjectByName(db, 'Hub');
    if (!hubProject || hubProject.project_type !== 'SYSTEM_HUB') {
      const id = insertProject(db, {
        name: 'Hub',
        description: 'Personal Operations Hub 自身项目（系统内建）：UI 改进、Worker 问题、Hub 功能开发。',
        workspacePath: null,
        projectType: 'SYSTEM_HUB',
        sortOrder: 0,
      });
      hubProject = findProject(db, id);
    }
    let hubGeneralConversation = db.prepare('SELECT * FROM conversations WHERE project_id = ? AND is_default = 1').get(hubProject.id);
    if (!hubGeneralConversation) {
      const id = insertConversation(db, {
        projectId: hubProject.id, title: 'General', kind: 'PROJECT', isDefault: 1,
      });
      hubGeneralConversation = findConversation(db, id);
    }
    return { globalConversation, hubProject, hubGeneralConversation };
  });
}

module.exports = { ensureSystemEntities };
