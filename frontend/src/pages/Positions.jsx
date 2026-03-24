import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardDoubleArrowUpIcon from "@mui/icons-material/KeyboardDoubleArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardDoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import CloseIcon from "@mui/icons-material/Close";

import {
    createPosition,
    deletePosition,
    getPeople,
    getPositionPeopleOrder,
    getPositions,
    reorderPositions,
    savePositionPeopleOrder,
    updatePosition,
} from "../api/scheduler";
import PageShell from "../components/PageShell";

const EVERYONE_ELSE = { personId: null, isEveryoneElse: true, name: "Everyone Else" };

const EMPTY_DRAFT = { name: "", required: true, canDoubleUp: false, peopleOrder: [EVERYONE_ELSE] };

function Positions({ activeRoleId, user }) {
    const [positions, setPositions] = useState([]);
    const [people, setPeople] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dragIndex, setDragIndex] = useState(null);
    const [form, setForm] = useState({ name: "", required: true, canDoubleUp: false });

    const [modalOpen, setModalOpen] = useState(false);
    const [editingPosition, setEditingPosition] = useState(null);
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [personDropdownValue, setPersonDropdownValue] = useState([]);

    const activeRoleName = user?.roles?.find((role) => role.id === activeRoleId)?.name || "Role";

    const sortedPositions = useMemo(
        () => [...positions].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
        [positions],
    );

    const peopleInOrder = useMemo(() => {
        const inList = new Set(draft.peopleOrder.filter((e) => !e.isEveryoneElse).map((e) => e.personId));
        return people.filter((p) => !inList.has(p.id));
    }, [draft.peopleOrder, people]);

    async function loadData() {
        if (!activeRoleId) {
            setPositions([]);
            setPeople([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError("");
        try {
            const [posData, peopleData] = await Promise.all([
                getPositions(activeRoleId),
                getPeople(activeRoleId),
            ]);
            setPositions(posData);
            setPeople(peopleData);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadData(); }, [activeRoleId]);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
            await createPosition({ name: form.name, required: Boolean(form.required), canDoubleUp: Boolean(form.canDoubleUp) }, activeRoleId);
            setForm({ name: "", required: true, canDoubleUp: false });
            await loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDrop(dropIndex) {
        if (dragIndex === null || dragIndex === dropIndex) { setDragIndex(null); return; }
        const next = [...sortedPositions];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIndex, 0, moved);
        setPositions(next);
        setDragIndex(null);
        try {
            await reorderPositions(next.map((p) => p.id), activeRoleId);
            await loadData();
        } catch (err) {
            setError(err.message);
            await loadData();
        }
    }

    async function openEdit(position) {
        setError("");
        try {
            const orderRows = await getPositionPeopleOrder(position.id, activeRoleId);
            let peopleOrder;
            if (orderRows.length === 0) {
                peopleOrder = [EVERYONE_ELSE];
            } else {
                peopleOrder = orderRows.map((row) =>
                    row.person_id === null
                        ? { ...EVERYONE_ELSE }
                        : { personId: row.person_id, isEveryoneElse: false, name: row.person_name },
                );
                if (!peopleOrder.some((e) => e.isEveryoneElse)) {
                    peopleOrder.push({ ...EVERYONE_ELSE });
                }
            }
            setDraft({ name: position.name, required: Boolean(position.required), canDoubleUp: Boolean(position.can_double_up), peopleOrder });
            setEditingPosition(position);
            setPersonDropdownValue([]);
            setModalOpen(true);
        } catch (err) {
            setError(err.message);
        }
    }

    function openAdd() {
        setDraft(EMPTY_DRAFT);
        setEditingPosition(null);
        setPersonDropdownValue([]);
        setModalOpen(true);
    }

    function closeModal() {
        if (saving) return;
        setModalOpen(false);
        setEditingPosition(null);
        setDraft(EMPTY_DRAFT);
        setPersonDropdownValue([]);
    }

    function movePerson(index, delta) {
        const next = [...draft.peopleOrder];
        const targetIndex = Math.max(0, Math.min(next.length - 1, index + delta));
        if (targetIndex === index) return;
        const [item] = next.splice(index, 1);
        next.splice(targetIndex, 0, item);
        setDraft((prev) => ({ ...prev, peopleOrder: next }));
    }

    function movePersonToTop(index) {
        const next = [...draft.peopleOrder];
        const [item] = next.splice(index, 1);
        next.unshift(item);
        setDraft((prev) => ({ ...prev, peopleOrder: next }));
    }

    function movePersonToBottom(index) {
        const next = [...draft.peopleOrder];
        const [item] = next.splice(index, 1);
        next.push(item);
        setDraft((prev) => ({ ...prev, peopleOrder: next }));
    }

    function removePerson(index) {
        setDraft((prev) => ({ ...prev, peopleOrder: prev.peopleOrder.filter((_, i) => i !== index) }));
    }

    function handlePersonDropdownChange(event) {
        const selected = event.target.value;
        setPersonDropdownValue(selected);
        const currentPersonIds = new Set(draft.peopleOrder.filter((e) => !e.isEveryoneElse).map((e) => e.personId));

        const toAdd = selected.filter((id) => !currentPersonIds.has(id));
        const toRemove = selected.length === 0 ? [] : [];

        if (toAdd.length > 0) {
            const everyoneElseIdx = draft.peopleOrder.findIndex((e) => e.isEveryoneElse);
            const newEntries = toAdd.map((id) => {
                const person = people.find((p) => p.id === id);
                return { personId: id, isEveryoneElse: false, name: person?.name || "Unknown" };
            });
            setDraft((prev) => {
                const next = [...prev.peopleOrder];
                const insertAt = everyoneElseIdx === -1 ? next.length : everyoneElseIdx;
                next.splice(insertAt, 0, ...newEntries);
                return { ...prev, peopleOrder: next };
            });
        }

        setPersonDropdownValue([]);
    }

    async function saveDraft(event) {
        event.preventDefault();
        if (!draft.name.trim()) { setError("Name is required."); return; }
        setSaving(true);
        setError("");
        try {
            let positionId;
            if (editingPosition) {
                await updatePosition(editingPosition.id, { name: draft.name, required: draft.required, canDoubleUp: draft.canDoubleUp }, activeRoleId);
                positionId = editingPosition.id;
            } else {
                const created = await createPosition({ name: draft.name, required: draft.required, canDoubleUp: draft.canDoubleUp }, activeRoleId);
                positionId = created.id;
            }
            const items = draft.peopleOrder.map((entry) => ({ personId: entry.isEveryoneElse ? null : entry.personId }));
            await savePositionPeopleOrder(positionId, items, activeRoleId);
            await loadData();
            closeModal();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!editingPosition) return;
        setError("");
        try {
            await deletePosition(editingPosition.id, activeRoleId);
            await loadData();
            closeModal();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <PageShell
            eyebrow="Configuration"
            title={`${activeRoleName} Positions`}
            description={`Manage scheduling positions for ${user?.roles?.find((role) => role.id === activeRoleId)?.name || "the selected role"}.`}
        >
            {!activeRoleId ? <Alert severity="warning" sx={{ mb: 2 }}>No role is selected for this account.</Alert> : null}
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                <Typography variant="h5">Add position</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <TextField
                        label="Position name"
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        required
                        fullWidth
                    />
                    <FormControlLabel
                        control={<Switch checked={Boolean(form.required)} onChange={(event) => setForm((prev) => ({ ...prev, required: event.target.checked }))} />}
                        label="Required"
                        sx={{ alignSelf: { sm: "center" }, mx: 0.5 }}
                    />
                    <FormControlLabel
                        control={<Switch checked={Boolean(form.canDoubleUp)} onChange={(event) => setForm((prev) => ({ ...prev, canDoubleUp: event.target.checked }))} />}
                        label="Double"
                        sx={{ alignSelf: { sm: "center" }, mx: 0.5 }}
                    />
                    <Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving..." : "Add"}</Button>
                </Stack>
            </Box>

            {loading ? <Typography>Loading positions...</Typography> : null}

            <Box className="hero-card form-stack">
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="h6">Position order</Typography>
                    <Button variant="outlined" size="small" onClick={openAdd}>Add position</Button>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                    Drag rows to set global priority. Top is highest priority.
                </Typography>
                <Divider />
                <Stack spacing={1}>
                    {sortedPositions.map((position, index) => (
                        <Box
                            key={position.id}
                            draggable
                            onDragStart={() => setDragIndex(index)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => handleDrop(index)}
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
                            <Stack direction="row" spacing={1} alignItems="flex-start">
                                <DragIndicatorRoundedIcon fontSize="small" color="action" sx={{ mt: 0.3 }} />
                                <Box>
                                    <Typography>{position.name}</Typography>
                                    <Stack direction="row" spacing={1}>
                                        {position.required ? <Typography variant="caption" color="text.secondary">Required</Typography> : null}
                                        {position.can_double_up ? <Typography variant="caption" color="text.secondary">Double</Typography> : null}
                                    </Stack>
                                </Box>
                            </Stack>
                            <Button size="small" variant="outlined" onClick={() => openEdit(position)}>Edit</Button>
                        </Box>
                    ))}
                </Stack>
            </Box>

            <Dialog open={modalOpen} onClose={closeModal} scroll="paper" fullWidth maxWidth="sm">
                <DialogTitle>{editingPosition ? `Edit: ${editingPosition.name}` : "New position"}</DialogTitle>
                <DialogContent dividers>
                    <Box component="form" id="position-form" onSubmit={saveDraft} className="form-stack">
                        <TextField
                            label="Name"
                            value={draft.name}
                            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                            required
                            fullWidth
                        />

                        <Divider />

                        <Box className="form-stack">
                            <Typography variant="subtitle1">People order</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Set priority order for tie-breaking. "Everyone Else" represents all unranked people.
                            </Typography>

                            <TextField
                                select
                                label="Add people to order"
                                value={personDropdownValue}
                                onChange={handlePersonDropdownChange}
                                SelectProps={{ multiple: true, renderValue: () => "Select people to add" }}
                                sx={{ minWidth: 280 }}
                            >
                                {peopleInOrder.map((person) => (
                                    <MenuItem key={person.id} value={person.id}>
                                        <Checkbox checked={personDropdownValue.includes(person.id)} size="small" />
                                        <ListItemText primary={person.name} />
                                    </MenuItem>
                                ))}
                            </TextField>

                            <Stack spacing={0.5}>
                                {draft.peopleOrder.map((entry, index) => (
                                    <Box
                                        key={entry.isEveryoneElse ? "__everyone_else__" : entry.personId}
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            border: "1px solid rgba(15, 118, 110, 0.18)",
                                            borderRadius: 0.5,
                                            px: 1,
                                            py: 0.5,
                                            backgroundColor: entry.isEveryoneElse ? "rgba(0,0,0,0.04)" : "rgba(255, 250, 242, 0.85)",
                                        }}
                                    >
                                        <Typography variant="body2" sx={{ fontStyle: entry.isEveryoneElse ? "italic" : "normal" }}>
                                            {entry.name}
                                        </Typography>
                                        <Stack direction="row" spacing={0} alignItems="center">
                                            <IconButton size="small" onClick={() => movePersonToTop(index)} disabled={index === 0} title="Move to top">
                                                <KeyboardDoubleArrowUpIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={() => movePerson(index, -1)} disabled={index === 0} title="Move up">
                                                <KeyboardArrowUpIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={() => movePerson(index, 1)} disabled={index === draft.peopleOrder.length - 1} title="Move down">
                                                <KeyboardArrowDownIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={() => movePersonToBottom(index)} disabled={index === draft.peopleOrder.length - 1} title="Move to bottom">
                                                <KeyboardDoubleArrowDownIcon fontSize="small" />
                                            </IconButton>
                                            {entry.isEveryoneElse ? (
                                                <IconButton size="small" disabled sx={{ color: "rgba(0,0,0,0.04) !important" }}>
                                                    <CloseIcon fontSize="small" />
                                                </IconButton>
                                            ) : (
                                                <IconButton size="small" onClick={() => removePerson(index)} title="Remove">
                                                    <CloseIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Stack>
                                    </Box>
                                ))}
                            </Stack>
                        </Box>

                        <Divider />

                        <Stack direction="row" spacing={2}>
                            <FormControlLabel
                                control={<Switch checked={Boolean(draft.required)} onChange={(event) => setDraft((prev) => ({ ...prev, required: event.target.checked }))} />}
                                label="Required"
                            />
                            <FormControlLabel
                                control={<Switch checked={Boolean(draft.canDoubleUp)} onChange={(event) => setDraft((prev) => ({ ...prev, canDoubleUp: event.target.checked }))} />}
                                label="Double"
                            />
                        </Stack>
                    </Box>
                </DialogContent>
                <DialogActions sx={{ justifyContent: "space-between", px: 3, py: 1.5 }}>
                    <Box>
                        {editingPosition && (
                            <Button color="error" onClick={handleDelete} disabled={saving}>Delete</Button>
                        )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                        <Button onClick={closeModal} disabled={saving}>Cancel</Button>
                        <Button variant="contained" type="submit" form="position-form" disabled={saving}>
                            {saving ? "Saving..." : "Save"}
                        </Button>
                    </Stack>
                </DialogActions>
            </Dialog>
        </PageShell>
    );
}

export default Positions;
