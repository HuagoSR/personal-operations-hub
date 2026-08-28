'use strict';

function insertProject(db, p) {
  const res = db.prepare('INSERT INTO projects (name, description, workspace_path) VALUES (?, ?, ?)')
    .run(p.name, p.description || null, p.workspacePath || null);
  return Number(res.lastInsertRowid);
}

function findProject(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
}

function findProjectByName(db, name) {
  return db.prepare('SELECT * FROM projects WHERE name = ?').get(name) || null;
}

function listProjects(db, limit = 100) {
  return db.prepare('SELECT * FROM projects ORDER BY id LIMIT ?').all(limit);
}

module.exports = { insertProject, findProject, findProjectByName, listProjects };
