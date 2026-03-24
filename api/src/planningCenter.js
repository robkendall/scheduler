const BASE_URL = "https://api.planningcenteronline.com/services/v2";

function normalizeText(value) {
    const text = String(value || "").trim();
    return text || null;
}

function authHeader(appId, secret) {
    const raw = `${appId}:${secret}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function normalizeBasicToken(value) {
    const token = normalizeText(value);
    if (!token) {
        return null;
    }

    return token.startsWith("Basic ") ? token : `Basic ${token}`;
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function resourceIdFromRelationship(resource, relName) {
    const data = resource?.relationships?.[relName]?.data;
    if (!data) {
        return null;
    }

    if (Array.isArray(data)) {
        return null;
    }

    return normalizeText(data.id);
}

function personDisplayName(resource) {
    const attributes = resource?.attributes || {};
    const direct = normalizeText(attributes.name);
    if (direct) {
        return direct;
    }

    const first = normalizeText(attributes.first_name) || "";
    const last = normalizeText(attributes.last_name) || "";
    const full = normalizeText(`${first} ${last}`);
    if (full) {
        return full;
    }

    return `Person ${resource?.id || "unknown"}`;
}

function personEmail(resource) {
    const attributes = resource?.attributes || {};
    return normalizeText(attributes.email) || normalizeText(attributes.primary_email) || null;
}

function positionName(resource) {
    const attributes = resource?.attributes || {};
    return normalizeText(attributes.name) || normalizeText(attributes.title) || `Position ${resource?.id || "unknown"}`;
}

function normalizeDateOnly(value) {
    const text = normalizeText(value);
    if (!text) {
        return null;
    }

    const direct = text.match(/^\d{4}-\d{2}-\d{2}/);
    if (direct) {
        return direct[0];
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}

function blockoutRange(blockoutResource, blockoutDateResource) {
    const blockoutAttrs = blockoutResource?.attributes || {};
    const dateAttrs = blockoutDateResource?.attributes || {};

    const start = normalizeDateOnly(
        dateAttrs.start_date || dateAttrs.starts_at || dateAttrs.start || dateAttrs.date || blockoutAttrs.start_date || blockoutAttrs.starts_at,
    );
    const end = normalizeDateOnly(
        dateAttrs.end_date || dateAttrs.ends_at || dateAttrs.end || dateAttrs.date || blockoutAttrs.end_date || blockoutAttrs.ends_at,
    );

    if (!start || !end) {
        return null;
    }

    if (start <= end) {
        return { startDate: start, endDate: end };
    }

    return { startDate: end, endDate: start };
}

function weekNumbersFromDates(planDates) {
    const weekSet = new Set();
    for (const dateStr of planDates) {
        const date = new Date(`${dateStr}T12:00:00Z`);
        if (!Number.isNaN(date.getTime())) {
            weekSet.add(Math.ceil(date.getDate() / 7));
        }
    }
    return [...weekSet].sort((a, b) => a - b);
}

function makePlanningCenterClient({ appId, secret, authToken }) {
    const safeAppId = normalizeText(appId);
    const safeSecret = normalizeText(secret);
    const safeAuthToken = normalizeBasicToken(authToken);

    if (!safeAuthToken && (!safeAppId || !safeSecret)) {
        throw new Error("Planning Center credentials are not configured. Set PCO_AUTH_TOKEN, or set both PCO_APP_ID/PCO_SECRET (or PCO_CLIENT_ID/PCO_CLIENT_SECRET).");
    }

    async function request(pathOrUrl) {
        const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
        const response = await fetch(url, {
            headers: {
                Accept: "application/json",
                Authorization: safeAuthToken || authHeader(safeAppId, safeSecret),
            },
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            const detail = payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || `HTTP ${response.status}`;
            throw new Error(`Planning Center request failed: ${detail}`);
        }

        return payload;
    }

    async function paginate(path) {
        const rows = [];
        let nextUrl = `${BASE_URL}${path}`;

        while (nextUrl) {
            const payload = await request(nextUrl);
            rows.push(...toArray(payload.data));
            nextUrl = normalizeText(payload?.links?.next);
        }

        return rows;
    }

    async function paginateWithFallback(paths) {
        let lastError = null;

        for (const path of paths) {
            try {
                // eslint-disable-next-line no-await-in-loop
                return await paginate(path);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Planning Center request failed.");
    }

    async function fetchTeamPlanHistory(teamId, serviceTypeId, validPersonIds) {
        const weekSetByPerson = new Map();
        const scheduledAssignments = [];
        const today = new Date();
        const todayText = today.toISOString().slice(0, 10);
        const sixMonthsAgo = new Date(today);
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const sixMonthsAgoText = sixMonthsAgo.toISOString().slice(0, 10);

        if (!teamId || !serviceTypeId) {
            return { weekSetByPerson, scheduledAssignments };
        }

        let plans = [];
        try {
            plans = await paginateWithFallback([
                `/service_types/${serviceTypeId}/plans?per_page=100&order=-sort_date`,
            ]);
        } catch (_error) {
            return { weekSetByPerson, scheduledAssignments };
        }

        for (const plan of plans) {
            const planId = normalizeText(plan?.id);
            const sortDate = normalizeDateOnly(plan?.attributes?.sort_date || plan?.attributes?.starts_at || plan?.attributes?.date);
            if (!planId || !sortDate) {
                continue;
            }

            const planDate = new Date(`${sortDate}T12:00:00Z`);
            if (Number.isNaN(planDate.getTime())) {
                continue;
            }
            const weekNumber = Math.ceil(planDate.getUTCDate() / 7);
            const isPast = sortDate < todayText;
            const inScheduleWindow = sortDate >= sixMonthsAgoText;

            let members = [];
            try {
                // Team members on a plan are nested under service_type + plan.
                // eslint-disable-next-line no-await-in-loop
                members = await paginateWithFallback([
                    `/service_types/${serviceTypeId}/plans/${planId}/team_members?per_page=100`,
                ]);
            } catch (_error) {
                // eslint-disable-next-line no-continue
                continue;
            }

            for (const member of members) {
                const memberTeamId = resourceIdFromRelationship(member, "team");
                if (!memberTeamId || memberTeamId !== teamId) {
                    continue;
                }

                const status = normalizeText(member?.attributes?.status);
                if (status === "D") {
                    continue;
                }

                const personId =
                    resourceIdFromRelationship(member, "person") ||
                    normalizeText(member?.attributes?.person_id);

                if (!personId || !validPersonIds.has(personId)) {
                    continue;
                }

                if (isPast) {
                    if (!weekSetByPerson.has(personId)) {
                        weekSetByPerson.set(personId, new Set());
                    }
                    weekSetByPerson.get(personId).add(weekNumber);
                }

                if (inScheduleWindow) {
                    const positionName = normalizeText(member?.attributes?.team_position_name);
                    if (positionName) {
                        scheduledAssignments.push({
                            trackDate: sortDate,
                            personId,
                            positionName,
                        });
                    }
                }
            }
        }

        return { weekSetByPerson, scheduledAssignments };
    }

    async function loadTeamBundle(teamId) {
        const safeTeamId = normalizeText(teamId);
        if (!safeTeamId) {
            throw new Error("A Planning Center team id is required.");
        }

        const [teamResourcePayload, teamPeople, teamPositions, assignments] = await Promise.all([
            request(`/teams/${safeTeamId}`),
            paginateWithFallback([
                `/teams/${safeTeamId}/people?per_page=100`,
                `/teams/${safeTeamId}/team_members?per_page=100`,
            ]),
            paginate(`/teams/${safeTeamId}/team_positions?per_page=100`),
            paginate(`/teams/${safeTeamId}/person_team_position_assignments?per_page=100`),
        ]);

        const teamResource = teamResourcePayload?.data || {};
        const teamServiceTypeId = resourceIdFromRelationship(teamResource, "service_type");

        const people = teamPeople.map((resource) => ({
            id: resourceIdFromRelationship(resource, "person") || normalizeText(resource.id),
            name: personDisplayName(resource),
        })).filter((item) => item.id);

        const positions = teamPositions.map((resource) => ({
            id: normalizeText(resource.id),
            name: positionName(resource),
        })).filter((item) => item.id);

        const mappedAssignments = assignments.map((resource) => ({
            personId: resourceIdFromRelationship(resource, "person"),
            positionId: resourceIdFromRelationship(resource, "team_position"),
        })).filter((item) => item.personId && item.positionId);

        const blockoutRangesByPerson = new Map();

        for (const person of people) {
            let personBlockouts = [];
            try {
                // Blockouts can be unavailable for some credential scopes/API surfaces.
                // Keep import functional by treating blockouts as optional.
                // eslint-disable-next-line no-await-in-loop
                personBlockouts = await paginateWithFallback([
                    `/people/${person.id}/blockouts?per_page=100`,
                    `https://api.planningcenteronline.com/people/v2/people/${person.id}/blockouts?per_page=100`,
                ]);
            } catch (_error) {
                blockoutRangesByPerson.set(person.id, []);
                // eslint-disable-next-line no-continue
                continue;
            }
            const ranges = [];

            for (const blockout of personBlockouts) {
                const blockoutId = normalizeText(blockout.id);
                if (!blockoutId) {
                    continue;
                }

                // First try the blockout's own dates (starts_at / ends_at on the resource).
                // This covers simple non-recurring blockouts and is the most reliable source.
                const directRange = blockoutRange(blockout, null);
                if (directRange) {
                    ranges.push(directRange);
                    continue;
                }

                // Blockout has no usable direct dates (e.g. recurring-only entries).
                // Fall back to individual blockout_dates occurrences.
                let blockoutDates = [];
                try {
                    // eslint-disable-next-line no-await-in-loop
                    blockoutDates = await paginateWithFallback([
                        `/people/${person.id}/blockouts/${blockoutId}/blockout_dates?per_page=100`,
                        `https://api.planningcenteronline.com/people/v2/people/${person.id}/blockouts/${blockoutId}/blockout_dates?per_page=100`,
                    ]);
                } catch (_error) {
                    blockoutDates = [];
                }

                for (const blockoutDate of blockoutDates) {
                    const range = blockoutRange(blockout, blockoutDate);
                    if (range) {
                        ranges.push(range);
                    }
                }
            }

            blockoutRangesByPerson.set(person.id, ranges);
        }

        const scheduledWeeksByPerson = new Map();
        const scheduledAssignments = [];
        const validPersonIds = new Set(people.map((person) => person.id));
        const history = await fetchTeamPlanHistory(safeTeamId, teamServiceTypeId, validPersonIds);
        for (const [personId, weekSet] of history.weekSetByPerson.entries()) {
            const inferredWeeks = [...weekSet].sort((a, b) => a - b);
            if (inferredWeeks.length > 0) {
                scheduledWeeksByPerson.set(personId, inferredWeeks);
            }
        }
        scheduledAssignments.push(...history.scheduledAssignments);

        return {
            people,
            positions,
            assignments: mappedAssignments,
            blockoutRangesByPerson,
            scheduledWeeksByPerson,
            scheduledAssignments,
        };
    }

    async function listTeamMembers(teamId) {
        const safeTeamId = normalizeText(teamId);
        if (!safeTeamId) {
            throw new Error("A Planning Center team id is required.");
        }

        const rawMembers = await paginateWithFallback([
            `/teams/${safeTeamId}/people?per_page=100`,
            `/teams/${safeTeamId}/team_members?per_page=100`,
        ]);

        const membersById = new Map();

        for (const resource of rawMembers) {
            const personId = resourceIdFromRelationship(resource, "person") || normalizeText(resource.id);
            if (!personId) {
                continue;
            }

            const nextMember = {
                id: personId,
                name: personDisplayName(resource).replace(`Person ${resource?.id || "unknown"}`, `Person ${personId}`),
                email: personEmail(resource),
            };

            if (!membersById.has(personId)) {
                membersById.set(personId, nextMember);
                continue;
            }

            const existing = membersById.get(personId);
            const existingIsFallbackName = existing.name === `Person ${personId}`;
            const nextIsBetterName = nextMember.name !== `Person ${personId}`;

            if (existingIsFallbackName && nextIsBetterName) {
                existing.name = nextMember.name;
            }

            if (!existing.email && nextMember.email) {
                existing.email = nextMember.email;
            }
        }

        return Array.from(membersById.values()).sort((left, right) => left.name.localeCompare(right.name));
    }

    async function getConnectionHealth() {
        const payload = await request("/service_types?per_page=1");
        const firstServiceType = toArray(payload?.data)[0] || null;

        return {
            ok: true,
            organizationId: null,
            organizationName: null,
            sampleServiceTypeId: normalizeText(firstServiceType?.id),
            sampleServiceTypeName: normalizeText(firstServiceType?.attributes?.name) || null,
        };
    }

    async function listTeams() {
        try {
            const teams = await paginate("/teams?per_page=100&order=name");
            return teams
                .map((resource) => ({
                    id: normalizeText(resource.id),
                    name: normalizeText(resource?.attributes?.name) || `Team ${resource?.id || "unknown"}`,
                }))
                .filter((item) => item.id)
                .sort((left, right) => left.name.localeCompare(right.name));
        } catch (_error) {
            const serviceTypes = await listServiceTypes();
            const teams = [];

            for (const serviceType of serviceTypes) {
                // eslint-disable-next-line no-await-in-loop
                const scopedTeams = await paginateWithFallback([
                    `/service_types/${serviceType.id}/teams?per_page=100&order=name`,
                ]);

                for (const team of scopedTeams) {
                    teams.push({
                        id: normalizeText(team.id),
                        name: normalizeText(team?.attributes?.name) || `Team ${team?.id || "unknown"}`,
                    });
                }
            }

            const dedupedById = new Map();
            for (const team of teams) {
                if (!team.id || dedupedById.has(team.id)) {
                    continue;
                }
                dedupedById.set(team.id, team);
            }

            return Array.from(dedupedById.values()).sort((left, right) => left.name.localeCompare(right.name));
        }
    }

    async function listServiceTypes() {
        const serviceTypes = await paginate("/service_types?per_page=100&order=name");
        return serviceTypes
            .map((resource) => ({
                id: normalizeText(resource.id),
                name: normalizeText(resource?.attributes?.name) || `Service Type ${resource?.id || "unknown"}`,
            }))
            .filter((item) => item.id)
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    return {
        getConnectionHealth,
        listTeams,
        listServiceTypes,
        listTeamMembers,
        loadTeamBundle,
    };
}

module.exports = {
    makePlanningCenterClient,
};
