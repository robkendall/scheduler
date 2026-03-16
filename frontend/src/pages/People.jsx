import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";

import {
    addPersonPosition,
    createBlockedOut,
    createNormalWeek,
    createPerson,
    deleteBlockedOut,
    deleteNormalWeek,
    deletePerson,
    getBlockedOut,
    getNormalWeeks,
    getPeople,
    getPeoplePositions,
    getPositions,
    removePersonPosition,
    reorderPersonPositions,
    updatePerson,
} from "../api/scheduler";
import PageShell from "../components/PageShell";
import { formatDisplayDate } from "../utils/date";

const EMPTY_DRAFT = {
    name: "",
    includeInAutoSchedule: true,
    normalWeeks: [],
    blockedOut: [],
    positionIds: [],
};

function People() {
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [people, setPeople] = useState([]);
    const [normalWeeks, setNormalWeeks] = useState([]);
    const [blockedOut, setBlockedOut] = useState([]);
    const [positions, setPositions] = useState([]);
    const [peoplePositions, setPeoplePositions] = useState([]);

    const [selectedPersonId, setSelectedPersonId] = useState(null);
    const [isNewDraft, setIsNewDraft] = useState(true);
    const [draft, setDraft] = useState(EMPTY_DRAFT);

    const [blockedInput, setBlockedInput] = useState({ startDate: "", endDate: "" });
    const [positionInput, setPositionInput] = useState("");
    const [dragIndex, setDragIndex] = useState(null);
    const panelRef = useRef(null);

    async function loadData() {
        setLoading(true);
        setError("");

        try {
            const [peopleData, normalData, blockedData, positionsData, peoplePositionsData] = await Promise.all([
                getPeople(),
                getNormalWeeks(),
                getBlockedOut(),
                getPositions(),
                getPeoplePositions(),
            ]);

            setPeople(peopleData);
            setNormalWeeks(normalData);
            setBlockedOut(blockedData);
            setPositions(positionsData);
            setPeoplePositions(peoplePositionsData);

            return {
                people: peopleData,
                normalWeeks: normalData,
                blockedOut: blockedData,
                positions: positionsData,
                peoplePositions: peoplePositionsData,
            };
        } catch (requestError) {
            setError(requestError.message);
            return null;
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    function beginNewDraft() {
        setIsNewDraft(true);
        setSelectedPersonId(null);
        setDraft(EMPTY_DRAFT);
        setBlockedInput({ startDate: "", endDate: "" });
        setPositionInput("");
        setDragIndex(null);
    }

    function buildDraftFromPerson(personId, data = null) {
        const sourcePeople = data?.people || people;
        const sourceNormalWeeks = data?.normalWeeks || normalWeeks;
        const sourceBlockedOut = data?.blockedOut || blockedOut;
        const sourcePeoplePositions = data?.peoplePositions || peoplePositions;

        const person = sourcePeople.find((item) => item.id === personId);
        if (!person) {
            return EMPTY_DRAFT;
        }

        const personWeeks = sourceNormalWeeks
            .filter((item) => item.person_id === personId)
            .map((item) => ({ id: item.id, weekNumber: item.week_number }))
            .sort((left, right) => left.weekNumber - right.weekNumber);

        const personBlocked = sourceBlockedOut
            .filter((item) => item.person_id === personId)
            .map((item) => ({
                id: item.id,
                startDate: String(item.start_date),
                endDate: String(item.end_date),
            }))
            .sort((left, right) => left.startDate.localeCompare(right.startDate));

        const personPositionIds = sourcePeoplePositions
            .filter((item) => item.person_id === personId)
            .sort((left, right) => left.rank_order - right.rank_order)
            .map((item) => item.position_id);

        return {
            name: person.name,
            includeInAutoSchedule: Boolean(person.include_in_auto_schedule),
            normalWeeks: personWeeks,
            blockedOut: personBlocked,
            positionIds: personPositionIds,
        };
    }

    function beginEdit(personId) {
        setIsNewDraft(false);
        setSelectedPersonId(personId);
        setDraft(buildDraftFromPerson(personId));
        setBlockedInput({ startDate: "", endDate: "" });
        setPositionInput("");
        setDragIndex(null);
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function beginEditWithData(personId, data) {
        setIsNewDraft(false);
        setSelectedPersonId(personId);
        setDraft(buildDraftFromPerson(personId, data));
        setBlockedInput({ startDate: "", endDate: "" });
        setPositionInput("");
        setDragIndex(null);
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const selectedPerson = useMemo(
        () => (selectedPersonId ? people.find((item) => item.id === selectedPersonId) || null : null),
        [people, selectedPersonId],
    );

    const availablePositions = useMemo(() => {
        const assigned = new Set(draft.positionIds);
        return positions.filter((position) => !assigned.has(position.id));
    }, [draft.positionIds, positions]);

    const rankedPositions = useMemo(() => {
        const map = new Map(positions.map((position) => [position.id, position]));
        return draft.positionIds
            .map((id) => map.get(id))
            .filter(Boolean);
    }, [draft.positionIds, positions]);

    const positionNameById = useMemo(
        () => new Map(positions.map((position) => [position.id, position.name])),
        [positions],
    );

    const positionNamesByPerson = useMemo(() => {
        const map = new Map();
        for (const item of peoplePositions) {
            if (!map.has(item.person_id)) {
                map.set(item.person_id, []);
            }
            const positionName = positionNameById.get(item.position_id);
            if (positionName) {
                map.get(item.person_id).push({ rank: item.rank_order, name: positionName });
            }
        }

        map.forEach((items, personId) => {
            map.set(
                personId,
                items
                    .sort((left, right) => left.rank - right.rank)
                    .map((item) => item.name),
            );
        });

        return map;
    }, [peoplePositions, positionNameById]);

    const weekSetByPerson = useMemo(() => {
        const map = new Map();
        for (const item of normalWeeks) {
            if (!map.has(item.person_id)) {
                map.set(item.person_id, new Set());
            }
            map.get(item.person_id).add(item.week_number);
        }
        return map;
    }, [normalWeeks]);

    function toggleNormalWeek(weekNumber) {
        const existing = draft.normalWeeks.find((item) => item.weekNumber === weekNumber);
        if (existing) {
            setDraft((prev) => ({
                ...prev,
                normalWeeks: prev.normalWeeks.filter((item) => item.weekNumber !== weekNumber),
            }));
        } else {
            setDraft((prev) => ({
                ...prev,
                normalWeeks: [...prev.normalWeeks, { weekNumber }].sort((a, b) => a.weekNumber - b.weekNumber),
            }));
        }
    }

    function addBlockedRangeToDraft() {
        if (!blockedInput.startDate || !blockedInput.endDate) {
            return;
        }

        if (blockedInput.startDate > blockedInput.endDate) {
            setError("Start date must be on or before end date.");
            return;
        }

        setDraft((prev) => ({
            ...prev,
            blockedOut: [...prev.blockedOut, { startDate: blockedInput.startDate, endDate: blockedInput.endDate }],
        }));
        setBlockedInput({ startDate: "", endDate: "" });
    }

    function removeBlockedRangeFromDraft(blockItem) {
        setDraft((prev) => ({
            ...prev,
            blockedOut: prev.blockedOut.filter((item) => item !== blockItem),
        }));
    }

    function addPositionToDraft() {
        const positionId = Number(positionInput);
        if (!positionId || draft.positionIds.includes(positionId)) {
            return;
        }

        setDraft((prev) => ({
            ...prev,
            positionIds: [...prev.positionIds, positionId],
        }));
        setPositionInput("");
    }

    function removePositionFromDraft(positionId) {
        setDraft((prev) => ({
            ...prev,
            positionIds: prev.positionIds.filter((id) => id !== positionId),
        }));
    }

    function handlePositionDrop(dropIndex) {
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            return;
        }

        const next = [...draft.positionIds];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIndex, 0, moved);
        setDraft((prev) => ({ ...prev, positionIds: next }));
        setDragIndex(null);
    }

    async function syncRelatedData(personId, existingWeeks, existingBlocked, existingPositionIds) {
        const desiredWeeks = draft.normalWeeks.map((item) => item.weekNumber);
        const weeksToDelete = existingWeeks.filter((item) => !desiredWeeks.includes(item.week_number));
        const weeksToAdd = desiredWeeks.filter((week) => !existingWeeks.some((item) => item.week_number === week));

        for (const item of weeksToDelete) {
            await deleteNormalWeek(item.id);
        }
        for (const week of weeksToAdd) {
            await createNormalWeek({ personId, weekNumber: week });
        }

        const existingBlockedIdsKept = new Set(
            draft.blockedOut.filter((item) => item.id).map((item) => item.id),
        );
        const blockedToDelete = existingBlocked.filter((item) => !existingBlockedIdsKept.has(item.id));
        for (const item of blockedToDelete) {
            await deleteBlockedOut(item.id);
        }

        const blockedToAdd = draft.blockedOut.filter((item) => !item.id);
        for (const item of blockedToAdd) {
            await createBlockedOut({
                personId,
                startDate: item.startDate,
                endDate: item.endDate,
            });
        }

        const desiredPositionIds = draft.positionIds;
        const positionsToRemove = existingPositionIds.filter((id) => !desiredPositionIds.includes(id));
        const positionsToAdd = desiredPositionIds.filter((id) => !existingPositionIds.includes(id));

        for (const positionId of positionsToRemove) {
            await removePersonPosition(personId, positionId);
        }
        for (const positionId of positionsToAdd) {
            await addPersonPosition(personId, positionId);
        }
        if (desiredPositionIds.length > 0) {
            await reorderPersonPositions(personId, desiredPositionIds);
        }
    }

    async function saveDraft(event) {
        event.preventDefault();
        setError("");

        if (!draft.name.trim()) {
            setError("Name is required.");
            return;
        }

        setSaving(true);
        try {
            if (isNewDraft) {
                const created = await createPerson({
                    name: draft.name,
                    includeInAutoSchedule: Boolean(draft.includeInAutoSchedule),
                });

                await syncRelatedData(created.id, [], [], []);
                const refreshedData = await loadData();
                beginEditWithData(created.id, refreshedData);
            } else {
                const personId = selectedPersonId;
                const existingWeeks = normalWeeks.filter((item) => item.person_id === personId);
                const existingBlocked = blockedOut.filter((item) => item.person_id === personId);
                const existingPositionIds = peoplePositions
                    .filter((item) => item.person_id === personId)
                    .sort((left, right) => left.rank_order - right.rank_order)
                    .map((item) => item.position_id);

                await updatePerson(personId, {
                    name: draft.name,
                    includeInAutoSchedule: Boolean(draft.includeInAutoSchedule),
                });

                await syncRelatedData(personId, existingWeeks, existingBlocked, existingPositionIds);
                const refreshedData = await loadData();
                beginEditWithData(personId, refreshedData);
            }
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function removeCurrentPerson() {
        if (isNewDraft || !selectedPersonId) {
            return;
        }

        setError("");
        try {
            await deletePerson(selectedPersonId);
            await loadData();
            beginNewDraft();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <PageShell
            eyebrow="Configuration"
            title="People"
            description="Add or edit one person at a time, including normal weeks, blocked dates, and position ranking."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            {loading ? <Typography sx={{ mb: 2 }}>Loading configuration...</Typography> : null}

            <Box ref={panelRef} className="hero-card form-stack" component="form" onSubmit={saveDraft} sx={{ mb: 2 }}>
                <Typography variant="h5">{isNewDraft ? "New person" : `Edit person: ${selectedPerson?.name || ""}`}</Typography>
                <TextField
                    label="Name"
                    value={draft.name}
                    onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                    required
                />
                <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2">Auto scheduling</Typography>
                    <Switch
                        checked={Boolean(draft.includeInAutoSchedule)}
                        onChange={(event) => setDraft((prev) => ({ ...prev, includeInAutoSchedule: event.target.checked }))}
                    />
                </Stack>

                <Divider />

                <Box className="form-stack">
                    <Typography variant="subtitle1">Normal weeks</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                        {[1, 2, 3, 4, 5].map((week) => (
                            <FormControlLabel
                                key={week}
                                label={`Week ${week}`}
                                control={
                                    <Checkbox
                                        checked={draft.normalWeeks.some((item) => item.weekNumber === week)}
                                        onChange={() => toggleNormalWeek(week)}
                                    />
                                }
                            />
                        ))}
                    </Stack>
                </Box>

                <Divider />

                <Box className="form-stack">
                    <Typography variant="subtitle1">Blocked out dates</Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            label="Start date"
                            type="date"
                            value={blockedInput.startDate}
                            onChange={(event) => {
                                const start = event.target.value;
                                setBlockedInput((prev) => ({
                                    startDate: start,
                                    endDate: prev.endDate || start,
                                }));
                            }}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            label="End date"
                            type="date"
                            value={blockedInput.endDate}
                            onChange={(event) => setBlockedInput((prev) => ({ ...prev, endDate: event.target.value }))}
                            InputLabelProps={{ shrink: true }}
                        />
                        <Button type="button" variant="contained" onClick={addBlockedRangeToDraft}>Add blocked range</Button>
                    </Stack>
                    <Stack spacing={0.5}>
                        {draft.blockedOut.length === 0 ? <Typography color="text.secondary">No blocked dates set.</Typography> : null}
                        {draft.blockedOut.map((item) => (
                            <Stack key={`${item.id || "draft"}-${item.startDate}-${item.endDate}`} direction="row" justifyContent="space-between" alignItems="center">
                                <Typography>{formatDisplayDate(item.startDate)} to {formatDisplayDate(item.endDate)}</Typography>
                                <Button size="small" color="error" onClick={() => removeBlockedRangeFromDraft(item)}>Remove</Button>
                            </Stack>
                        ))}
                    </Stack>
                </Box>

                <Divider />

                <Box className="form-stack">
                    <Typography variant="subtitle1">Positions</Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            select
                            label="Add position"
                            value={positionInput}
                            onChange={(event) => setPositionInput(event.target.value)}
                            sx={{ minWidth: 240 }}
                        >
                            {availablePositions.map((position) => (
                                <MenuItem key={position.id} value={String(position.id)}>
                                    {position.name}
                                </MenuItem>
                            ))}
                        </TextField>
                        <Button type="button" variant="contained" onClick={addPositionToDraft} disabled={!positionInput}>
                            Add position
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        Drag to rank this person's position preference.
                    </Typography>
                    <Stack spacing={1}>
                        {rankedPositions.length === 0 ? <Typography color="text.secondary">No positions assigned.</Typography> : null}
                        {rankedPositions.map((position, index) => (
                            <Box
                                key={position.id}
                                draggable
                                onDragStart={() => setDragIndex(index)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => handlePositionDrop(index)}
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    border: "1px solid rgba(15, 118, 110, 0.18)",
                                    borderRadius: 0.5,
                                    p: 1,
                                    backgroundColor: "rgba(255, 250, 242, 0.85)",
                                }}
                            >
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <DragIndicatorRoundedIcon fontSize="small" color="action" />
                                    <Typography>{position.name}</Typography>
                                </Stack>
                                <Button size="small" color="error" onClick={() => removePositionFromDraft(position.id)}>
                                    Remove
                                </Button>
                            </Box>
                        ))}
                    </Stack>
                </Box>

                <Divider />

                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}>
                        {saving ? "Saving..." : isNewDraft ? "Create person" : "Save changes"}
                    </Button>
                    {!isNewDraft ? (
                        <Button type="button" color="error" variant="outlined" onClick={removeCurrentPerson}>
                            Delete person
                        </Button>
                    ) : null}
                    {!isNewDraft ? (
                        <Button type="button" variant="outlined" onClick={() => selectedPersonId && beginEdit(selectedPersonId)}>
                            Reset changes
                        </Button>
                    ) : null}
                </Stack>
            </Box>

            <Box className="hero-card form-stack">
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }}>
                    <Typography variant="h5">People list</Typography>
                    <Button variant="contained" onClick={beginNewDraft}>New person</Button>
                </Stack>
                <Divider />
                <Stack spacing={1}>
                    {people.map((person) => (
                        <Box
                            key={person.id}
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                border: "1px solid rgba(15, 118, 110, 0.14)",
                                borderRadius: 0.5,
                                p: 1,
                                backgroundColor: selectedPersonId === person.id ? "rgba(15, 118, 110, 0.08)" : "transparent",
                                transition: "background-color 150ms ease",
                                "&:hover": {
                                    backgroundColor: "rgba(15, 118, 110, 0.06)",
                                },
                            }}
                        >
                            <Stack spacing={0.25}>
                                <Typography color={person.include_in_auto_schedule ? "text.primary" : "text.disabled"}>
                                    {person.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {(positionNamesByPerson.get(person.id) || []).join(", ") || "No positions assigned"}
                                </Typography>
                                <Stack direction="row" spacing={0.25}>
                                    {[1, 2, 3, 4, 5].map((week) => (
                                        <Checkbox
                                            key={`${person.id}-week-${week}`}
                                            size="small"
                                            checked={Boolean(weekSetByPerson.get(person.id)?.has(week))}
                                            disabled
                                            inputProps={{ "aria-label": `Week ${week}` }}
                                            sx={{ p: 0.2 }}
                                        />
                                    ))}
                                </Stack>
                                {!person.include_in_auto_schedule ? (
                                    <Typography variant="caption" color="text.disabled">
                                        Auto scheduling disabled
                                    </Typography>
                                ) : null}
                            </Stack>
                            <Button size="small" variant="outlined" onClick={() => beginEdit(person.id)}>
                                Edit
                            </Button>
                        </Box>
                    ))}
                </Stack>
            </Box>
        </PageShell>
    );
}

export default People;
