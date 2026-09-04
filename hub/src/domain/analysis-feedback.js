'use strict';

function insertFeedback(db, f) {
  const res = db.prepare(`INSERT INTO analysis_feedback
    (analysis_id, verdict, corrected_importance, corrected_urgency, corrected_project_id, task_suggestion, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(f.analysisId, f.verdict, f.correctedImportance || null, f.correctedUrgency || null,
      f.correctedProjectId || null, f.taskSuggestion || null, f.note || null);
  return Number(res.lastInsertRowid);
}

function listFeedback(db, analysisId) {
  if (analysisId) return db.prepare('SELECT * FROM analysis_feedback WHERE analysis_id = ? ORDER BY id').all(analysisId);
  return db.prepare('SELECT * FROM analysis_feedback ORDER BY id DESC LIMIT 200').all();
}

module.exports = { insertFeedback, listFeedback };
