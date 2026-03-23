import { apiFetch } from "./client";

async function readJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function request(path, options = {}) {
  const response = await apiFetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  return readJson(response);
}

function buildRoleQuery(path, roleId) {
  if (!roleId) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}roleId=${encodeURIComponent(roleId)}`;
}

function withRole(payload, roleId) {
  return {
    ...payload,
    roleId,
  };
}

export function getDashboard(roleId) {
  return request(buildRoleQuery("/api/dashboard", roleId));
}

export function getUsers() {
  return request("/api/users");
}

export function createUser(payload) {
  return request("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUser(id, payload) {
  return request(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteUser(id) {
  return request(`/api/users/${id}`, {
    method: "DELETE",
  });
}

export function getRoles() {
  return request("/api/roles");
}

export function createRole(payload) {
  return request("/api/roles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRole(id, payload) {
  return request(`/api/roles/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteRole(id) {
  return request(`/api/roles/${id}`, {
    method: "DELETE",
  });
}

export function getUserRoles(id) {
  return request(`/api/users/${id}/roles`);
}

export function updateUserRoles(id, roleIds) {
  return request(`/api/users/${id}/roles`, {
    method: "PUT",
    body: JSON.stringify({ roleIds }),
  });
}

export function getPeople(roleId) {
  return request(buildRoleQuery("/api/people", roleId));
}

export function createPerson(payload, roleId) {
  return request("/api/people", {
    method: "POST",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function updatePerson(id, payload, roleId) {
  return request(buildRoleQuery(`/api/people/${id}`, roleId), {
    method: "PUT",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function deletePerson(id, roleId) {
  return request(buildRoleQuery(`/api/people/${id}`, roleId), {
    method: "DELETE",
  });
}

export function getNormalWeeks(roleId) {
  return request(buildRoleQuery("/api/normal-weeks", roleId));
}

export function createNormalWeek(payload, roleId) {
  return request("/api/normal-weeks", {
    method: "POST",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function deleteNormalWeek(id, roleId) {
  return request(buildRoleQuery(`/api/normal-weeks/${id}`, roleId), {
    method: "DELETE",
  });
}

export function getBlockedOut(roleId) {
  return request(buildRoleQuery("/api/blocked-out", roleId));
}

export function createBlockedOut(payload, roleId) {
  return request("/api/blocked-out", {
    method: "POST",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function deleteBlockedOut(id, roleId) {
  return request(buildRoleQuery(`/api/blocked-out/${id}`, roleId), {
    method: "DELETE",
  });
}

export function getPositions(roleId) {
  return request(buildRoleQuery("/api/positions", roleId));
}

export function createPosition(payload, roleId) {
  return request("/api/positions", {
    method: "POST",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function updatePosition(id, payload, roleId) {
  return request(buildRoleQuery(`/api/positions/${id}`, roleId), {
    method: "PUT",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function reorderPositions(orderedPositionIds, roleId) {
  return request("/api/positions/reorder", {
    method: "PUT",
    body: JSON.stringify(withRole({ orderedPositionIds }, roleId)),
  });
}

export function deletePosition(id, roleId) {
  return request(buildRoleQuery(`/api/positions/${id}`, roleId), {
    method: "DELETE",
  });
}

export function getPeoplePositions(roleId) {
  return request(buildRoleQuery("/api/people-positions", roleId));
}

export function addPersonPosition(personId, positionId, roleId) {
  return request(`/api/people/${personId}/positions`, {
    method: "POST",
    body: JSON.stringify(withRole({ positionId }, roleId)),
  });
}

export function reorderPersonPositions(personId, orderedPositionIds, roleId) {
  return request(`/api/people/${personId}/positions/reorder`, {
    method: "PUT",
    body: JSON.stringify(withRole({ orderedPositionIds }, roleId)),
  });
}

export function removePersonPosition(personId, positionId, roleId) {
  return request(buildRoleQuery(`/api/people/${personId}/positions/${positionId}`, roleId), {
    method: "DELETE",
  });
}

export function getSchedule(month, roleId) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request(buildRoleQuery(`/api/schedule${query}`, roleId));
}

export function prepopulateSchedule(month, roleId) {
  return request("/api/schedule/prepopulate", {
    method: "POST",
    body: JSON.stringify(withRole({ month }, roleId)),
  });
}

export function createPeopleSchedule(payload, roleId) {
  return request("/api/people-schedule", {
    method: "POST",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function updatePeopleSchedule(id, payload, roleId) {
  return request(buildRoleQuery(`/api/people-schedule/${id}`, roleId), {
    method: "PUT",
    body: JSON.stringify(withRole(payload, roleId)),
  });
}

export function deletePeopleSchedule(id, roleId) {
  return request(buildRoleQuery(`/api/people-schedule/${id}`, roleId), {
    method: "DELETE",
  });
}

export function clearScheduleAssignments(scheduleId, roleId) {
  return request(buildRoleQuery(`/api/schedule/${scheduleId}/assignments`, roleId), {
    method: "DELETE",
  });
}

export function clearScheduleMonth(month, roleId) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request(buildRoleQuery(`/api/schedule${query}`, roleId), {
    method: "DELETE",
  });
}
