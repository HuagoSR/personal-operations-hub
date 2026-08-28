'use strict';

class HubError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.details = details || null;
  }
}

class InvalidTransitionError extends HubError {
  constructor(entityType, from, to) {
    super('INVALID_TRANSITION', `${entityType}: transition ${from} -> ${to} is not allowed`);
  }
}

class VersionConflictError extends HubError {
  constructor(entityType, id) {
    super('VERSION_CONFLICT', `${entityType} ${id}: state changed concurrently (version mismatch)`);
  }
}

class NotFoundError extends HubError {
  constructor(entityType, id) {
    super('NOT_FOUND', `${entityType} ${id || ''} not found`);
  }
}

class ApprovalExpiredError extends HubError {
  constructor(id, expiresAt) {
    super('APPROVAL_EXPIRED', `approval ${id} expired at ${expiresAt}`);
  }
}

class GrantRevokedError extends HubError {
  constructor(id) {
    super('GRANT_REVOKED', `execution grant ${id} is revoked`);
  }
}

class DuplicateError extends HubError {
  constructor(message) {
    super('DUPLICATE', message);
  }
}

class BadRequestError extends HubError {
  constructor(message) {
    super('BAD_REQUEST', message);
  }
}

module.exports = {
  HubError,
  InvalidTransitionError,
  VersionConflictError,
  NotFoundError,
  ApprovalExpiredError,
  GrantRevokedError,
  DuplicateError,
  BadRequestError,
};
