import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

import {
    clearScheduleMonth,
    clearScheduleAssignments,
    createPeopleSchedule,
    deletePeopleSchedule,
    getBlockedOut,
    getDashboard,
    getNormalWeeks,
    getPeople,
    getPeoplePositions,
    getPositions,
    getSchedule,
    prepopulateSchedule,
    updatePeopleSchedule,
} from "../api/scheduler";
import PageShell from "../components/PageShell";
import { formatDisplayDate } from "../utils/date";

function currentMonthText() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${now.getFullYear()}-${month}`;
}

function shiftMonthValue(monthValue, delta) {
    const [year, monthPart] = monthValue.split("-").map(Number);
    const next = new Date(year, monthPart - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function Dashboard({ user }) {
    const [month, setMonth] = useState(currentMonthText());
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [prepopulating, setPrepopulating] = useState(false);
    const [mutating, setMutating] = useState(false);
    const [clearConfirmId, setClearConfirmId] = useState(null);
    const [clearMonthConfirm, setClearMonthConfirm] = useState(false);
    const [dashboard, setDashboard] = useState(null);
    const [schedule, setSchedule] = useState([]);
    const [people, setPeople] = useState([]);
    const [peoplePositions, setPeoplePositions] = useState([]);
    const [normalWeeks, setNormalWeeks] = useState([]);
    const [blockedOut, setBlockedOut] = useState([]);
    const [positions, setPositions] = useState([]);
    const [prepopulateResult, setPrepopulateResult] = useState(null);
    const [addForms, setAddForms] = useState({});

    const [prepopulateConfirm, setPrepopulateConfirm] = useState(false);

    const totalAssignments = useMemo(
        () => schedule.reduce((sum, row) => sum + row.assignments.length, 0),
        [schedule],
    );

    const positionsAlphabetical = useMemo(
        () => [...positions].sort((left, right) => left.name.localeCompare(right.name)),
        [positions],
    );

    const normalWeeksByPerson = useMemo(() => {
        const map = new Map();
        for (const item of normalWeeks) {
            if (!map.has(item.person_id)) {
                map.set(item.person_id, new Set());
            }
            map.get(item.person_id).add(item.week_number);
        }
        return map;
    }, [normalWeeks]);

    const blockedByPerson = useMemo(() => {
        const map = new Map();
        for (const item of blockedOut) {
            if (!map.has(item.person_id)) {
                map.set(item.person_id, []);
            }
            map.get(item.person_id).push({
                startDate: String(item.start_date).slice(0, 10),
                endDate: String(item.end_date).slice(0, 10),
            });
        }
        return map;
    }, [blockedOut]);

    const positionIdsByPerson = useMemo(() => {
        const map = new Map();
        for (const item of peoplePositions) {
            if (!map.has(item.person_id)) {
                map.set(item.person_id, new Set());
            }
            map.get(item.person_id).add(item.position_id);
        }
        return map;
    }, [peoplePositions]);

    const loadAll = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const [dashboardData, scheduleData, peopleData, peoplePositionsData, normalWeeksData, blockedOutData, positionsData] = await Promise.all([
                getDashboard(),
                getSchedule(month),
                getPeople(),
                getPeoplePositions(),
                getNormalWeeks(),
                getBlockedOut(),
                getPositions(),
            ]);

            setDashboard(dashboardData);
            setSchedule(scheduleData);
            setPeople(peopleData);
            setPeoplePositions(peoplePositionsData);
            setNormalWeeks(normalWeeksData);
            setBlockedOut(blockedOutData);
            setPositions(positionsData);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, [month]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    async function runPrepopulate(force = false) {
        if (!force && totalAssignments > 0) {
            setPrepopulateConfirm(true);
            return;
        }
        setPrepopulateConfirm(false);
        setPrepopulating(true);
        setError("");
        setPrepopulateResult(null);

        try {
            const result = await prepopulateSchedule(month);
            setPrepopulateResult(result);
            await loadAll();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setPrepopulating(false);
        }
    }

    async function handleMovePerson(scheduleId, assignment, newPersonId) {
        setMutating(true);
        setError("");
        try {
            await updatePeopleSchedule(assignment.id, {
                scheduleId,
                personId: Number(newPersonId),
                positionId: assignment.positionId,
            });
            await loadAll();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setMutating(false);
        }
    }

    async function handleRemoveAssignment(assignmentId) {
        setMutating(true);
        setError("");
        try {
            await deletePeopleSchedule(assignmentId);
            await loadAll();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setMutating(false);
        }
    }

    async function handleClearWeek(scheduleId) {
        setMutating(true);
        setError("");
        setClearConfirmId(null);
        try {
            await clearScheduleAssignments(scheduleId);
            await loadAll();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setMutating(false);
        }
    }

    async function handleClearMonth() {
        setMutating(true);
        setError("");
        setPrepopulateResult(null);
        setClearMonthConfirm(false);

        try {
            await clearScheduleMonth(month);
            await loadAll();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setMutating(false);
        }
    }

    function getAddForm(scheduleId) {
        return addForms[scheduleId] || { personId: "", positionId: "" };
    }

    function setAddForm(scheduleId, patch) {
        setAddForms((prev) => ({
            ...prev,
            [scheduleId]: { ...(prev[scheduleId] || { personId: "", positionId: "" }), ...patch },
        }));
    }

    async function handleAddAssignment(scheduleId) {
        const form = getAddForm(scheduleId);
        if (!form.personId || !form.positionId) return;
        setMutating(true);
        setError("");
        try {
            await createPeopleSchedule({
                scheduleId,
                personId: Number(form.personId),
                positionId: Number(form.positionId),
            });
            setAddForms((prev) => ({ ...prev, [scheduleId]: { personId: "", positionId: "" } }));
            await loadAll();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setMutating(false);
        }
    }

    return (
        <PageShell
            eyebrow="Overview"
            title="Scheduler Dashboard"
            description={`Signed in as ${user?.username || "unknown"}. This page drives month generation and schedule visibility.`}
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            {prepopulateResult ? (
                <Alert severity="success" sx={{ mb: 2 }}>
                    Created {prepopulateResult.assignmentsCreated} assignments for {prepopulateResult.month}.
                </Alert>
            ) : null}

            {prepopulateConfirm ? (
                <Alert
                    severity="warning"
                    sx={{ mb: 2 }}
                    action={
                        <Stack direction="row" spacing={1}>
                            <Button size="small" color="warning" variant="contained" onClick={() => runPrepopulate(true)}>
                                Re-run anyway
                            </Button>
                            <Button size="small" onClick={() => setPrepopulateConfirm(false)}>
                                Cancel
                            </Button>
                        </Stack>
                    }
                >
                    {month} already has {totalAssignments} assignment{totalAssignments !== 1 ? "s" : ""}. Re-running will add more on top of existing ones.
                </Alert>
            ) : null}

            <Box className="hero-card form-stack" sx={{ mb: 2 }}>
                <Typography variant="h5">Month tools</Typography>
                <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    alignItems={{ sm: "center" }}
                    justifyContent="space-between"
                >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                        <IconButton
                            size="small"
                            aria-label="Previous month"
                            onClick={() => setMonth((prev) => shiftMonthValue(prev, -1))}
                        >
                            <ChevronLeftRoundedIcon />
                        </IconButton>
                        <TextField
                            label="Month"
                            type="month"
                            value={month}
                            onChange={(event) => setMonth(event.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <Button variant="contained" onClick={runPrepopulate} disabled={prepopulating}>
                            {prepopulating ? "Generating..." : "Pre-populate month"}
                        </Button>
                        {clearMonthConfirm ? (
                            <>
                                <Button color="error" variant="contained" onClick={handleClearMonth} disabled={mutating}>
                                    Confirm clear month
                                </Button>
                                <Button variant="outlined" onClick={() => setClearMonthConfirm(false)} disabled={mutating}>
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <Button color="error" variant="outlined" onClick={() => setClearMonthConfirm(true)} disabled={mutating}>
                                Clear month
                            </Button>
                        )}
                    </Stack>
                    <IconButton
                        size="small"
                        aria-label="Next month"
                        onClick={() => setMonth((prev) => shiftMonthValue(prev, 1))}
                        sx={{ alignSelf: { xs: "flex-end", sm: "center" } }}
                    >
                        <ChevronRightRoundedIcon />
                    </IconButton>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                    Uses normal weeks, blocked out windows, and position capability to build Sunday assignments.
                </Typography>
            </Box>

            <Box className="hero-card form-stack" sx={{ mt: 2 }}>
                <Typography variant="h5">Month schedule</Typography>
                {loading ? <Typography>Loading...</Typography> : null}
                {!loading && schedule.length === 0 ? (
                    <Typography color="text.secondary">No schedule rows for this month.</Typography>
                ) : null}
                <Stack spacing={2}>
                    {schedule.map((row) => {
                        const assignedPositionIds = new Set(row.assignments.map((a) => a.positionId));
                        const assignedPersonIds = new Set(row.assignments.map((a) => a.personId));
                        const availablePositions = positions.filter((p) => !assignedPositionIds.has(p.id));
                        const addForm = getAddForm(row.id);
                        const assignmentByPositionId = new Map(row.assignments.map((assignment) => [assignment.positionId, assignment]));
                        const displayEntries = positionsAlphabetical.map((position) => ({
                            position,
                            assignment: assignmentByPositionId.get(position.id) || null,
                        }));
                        const openPositionIds = new Set(
                            displayEntries
                                .filter((entry) => !entry.assignment)
                                .map((entry) => entry.position.id),
                        );
                        const trackDate = String(row.track_date).slice(0, 10);
                        const availableUnassigned = people
                            .filter((person) => person.include_in_auto_schedule !== false)
                            .filter((person) => normalWeeksByPerson.get(person.id)?.has(row.week_number))
                            .filter((person) => {
                                const blocks = blockedByPerson.get(person.id) || [];
                                return !blocks.some((block) => trackDate >= block.startDate && trackDate <= block.endDate);
                            })
                            .filter((person) => !assignedPersonIds.has(person.id));

                        const eligibleUnassigned = availableUnassigned
                            .filter((person) => {
                                const capablePositionIds = positionIdsByPerson.get(person.id);
                                if (!capablePositionIds || openPositionIds.size === 0) {
                                    return false;
                                }
                                for (const positionId of openPositionIds) {
                                    if (capablePositionIds.has(positionId)) {
                                        return true;
                                    }
                                }
                                return false;
                            })
                            .map((person) => person.name)
                            .sort((left, right) => left.localeCompare(right));

                        const availableNoOpenFit = availableUnassigned
                            .filter((person) => {
                                const capablePositionIds = positionIdsByPerson.get(person.id);
                                if (!capablePositionIds || openPositionIds.size === 0) {
                                    return true;
                                }
                                for (const positionId of openPositionIds) {
                                    if (capablePositionIds.has(positionId)) {
                                        return false;
                                    }
                                }
                                return true;
                            })
                            .map((person) => person.name)
                            .sort((left, right) => left.localeCompare(right));
                        return (
                            <Box key={row.id} sx={{ border: "1px solid rgba(15,118,110,0.2)", borderRadius: 0.5, p: 1.5 }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                                    <Typography sx={{ fontWeight: 700 }}>
                                        {formatDisplayDate(row.track_date)} (week {row.week_number})
                                    </Typography>
                                    {clearConfirmId === row.id ? (
                                        <Stack direction="row" spacing={1}>
                                            <Button size="small" color="error" variant="contained" onClick={() => handleClearWeek(row.id)} disabled={mutating}>
                                                Confirm clear
                                            </Button>
                                            <Button size="small" onClick={() => setClearConfirmId(null)}>Cancel</Button>
                                        </Stack>
                                    ) : (
                                        <Button size="small" color="error" variant="outlined" onClick={() => setClearConfirmId(row.id)} disabled={mutating}>
                                            Clear week
                                        </Button>
                                    )}
                                </Stack>
                                <Stack spacing={0.75}>
                                    {displayEntries.map(({ position, assignment }) => (
                                        <Stack key={position.id} direction="row" spacing={1} alignItems="center">
                                            <Stack sx={{ minWidth: 130, flexShrink: 0 }}>
                                                <Typography variant="body2">{position.name}</Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {position.required ? "Required" : "Optional"}
                                                </Typography>
                                            </Stack>
                                            {assignment ? (
                                                <>
                                                    <TextField
                                                        select
                                                        size="small"
                                                        value={String(assignment.personId)}
                                                        onChange={(event) => handleMovePerson(row.id, assignment, event.target.value)}
                                                        disabled={mutating}
                                                        sx={{ minWidth: 160 }}
                                                    >
                                                        {people.map((person) => (
                                                            <MenuItem key={person.id} value={String(person.id)}>
                                                                {person.name}
                                                            </MenuItem>
                                                        ))}
                                                    </TextField>
                                                    <Button
                                                        size="small"
                                                        color="error"
                                                        variant="outlined"
                                                        onClick={() => handleRemoveAssignment(assignment.id)}
                                                        disabled={mutating}
                                                    >
                                                        Remove
                                                    </Button>
                                                </>
                                            ) : (
                                                <Typography variant="body2" color="text.secondary">
                                                    Empty
                                                </Typography>
                                            )}
                                        </Stack>
                                    ))}
                                </Stack>
                                <Divider sx={{ my: 1 }} />
                                <Typography variant="body2" color="text.secondary">
                                    Eligible unassigned: {eligibleUnassigned.length > 0 ? eligibleUnassigned.join(", ") : "None"}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Available, no open fit: {availableNoOpenFit.length > 0 ? availableNoOpenFit.join(", ") : "None"}
                                </Typography>
                                {availablePositions.length > 0 ? (
                                    <>
                                        <Divider sx={{ my: 1 }} />
                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                                            <TextField
                                                select
                                                size="small"
                                                label="Position"
                                                value={addForm.positionId}
                                                onChange={(event) => setAddForm(row.id, { positionId: event.target.value })}
                                                disabled={mutating}
                                                sx={{ minWidth: 160 }}
                                            >
                                                {availablePositions.map((position) => (
                                                    <MenuItem key={position.id} value={String(position.id)}>
                                                        {position.name}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            <TextField
                                                select
                                                size="small"
                                                label="Person"
                                                value={addForm.personId}
                                                onChange={(event) => setAddForm(row.id, { personId: event.target.value })}
                                                disabled={mutating}
                                                sx={{ minWidth: 160 }}
                                            >
                                                {people.map((person) => (
                                                    <MenuItem key={person.id} value={String(person.id)}>
                                                        {person.name}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                onClick={() => handleAddAssignment(row.id)}
                                                disabled={mutating || !addForm.personId || !addForm.positionId}
                                            >
                                                Add
                                            </Button>
                                        </Stack>
                                    </>
                                ) : null}
                            </Box>
                        );
                    })}
                </Stack>
            </Box>
        </PageShell>
    );
}

export default Dashboard;
