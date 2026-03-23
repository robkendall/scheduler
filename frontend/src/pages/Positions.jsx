import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";

import {
    createPosition,
    deletePosition,
    getPositions,
    reorderPositions,
    updatePosition,
} from "../api/scheduler";
import PageShell from "../components/PageShell";

function Positions({ activeRoleId, user }) {
    const [positions, setPositions] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [updatingId, setUpdatingId] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState("");
    const [dragIndex, setDragIndex] = useState(null);
    const [form, setForm] = useState({ name: "", required: true });
    const activeRoleName = user?.roles?.find((role) => role.id === activeRoleId)?.name || "Role";

    const sortedPositions = useMemo(
        () => [...positions].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
        [positions],
    );

    async function loadPositions() {
        if (!activeRoleId) {
            setPositions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError("");

        try {
            const data = await getPositions(activeRoleId);
            setPositions(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadPositions();
    }, [activeRoleId]);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        try {
            await createPosition({
                name: form.name,
                required: Boolean(form.required),
            }, activeRoleId);
            setForm({ name: "", required: true });
            await loadPositions();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function toggleRequired(position, nextRequired) {
        setUpdatingId(position.id);
        setError("");

        try {
            await updatePosition(position.id, {
                name: position.name,
                required: nextRequired,
            }, activeRoleId);
            await loadPositions();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setUpdatingId(null);
        }
    }

    function startEditing(position) {
        setEditingId(position.id);
        setEditingName(position.name);
        setError("");
    }

    function cancelEditing() {
        setEditingId(null);
        setEditingName("");
    }

    async function savePositionName(position) {
        const trimmedName = editingName.trim();
        if (!trimmedName) {
            setError("Position name is required.");
            return;
        }

        setUpdatingId(position.id);
        setError("");

        try {
            await updatePosition(position.id, {
                name: trimmedName,
                required: Boolean(position.required),
            }, activeRoleId);
            cancelEditing();
            await loadPositions();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setUpdatingId(null);
        }
    }

    async function removePosition(id) {
        setError("");

        try {
            await deletePosition(id, activeRoleId);
            await loadPositions();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function handleDrop(dropIndex) {
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            return;
        }

        const next = [...sortedPositions];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIndex, 0, moved);
        setPositions(next);
        setDragIndex(null);

        try {
            await reorderPositions(next.map((position) => position.id), activeRoleId);
            await loadPositions();
        } catch (requestError) {
            setError(requestError.message);
            await loadPositions();
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
                        control={
                            <Switch
                                checked={Boolean(form.required)}
                                onChange={(event) => setForm((prev) => ({ ...prev, required: event.target.checked }))}
                            />
                        }
                        label="Required"
                        sx={{ alignSelf: { sm: "center" }, mx: 0.5 }}
                    />
                    <Button type="submit" variant="contained" disabled={saving}>
                        {saving ? "Saving..." : "Add"}
                    </Button>
                </Stack>
            </Box>

            {loading ? <Typography>Loading positions...</Typography> : null}

            <Box className="hero-card form-stack">
                <Typography variant="h6">Position order</Typography>
                <Typography variant="body2" color="text.secondary">
                    Drag rows to set global priority. Top is highest priority.
                </Typography>
                <Divider />
                <Stack spacing={1}>
                    {sortedPositions.map((position, index) => (
                        <Box
                            key={position.id}
                            draggable
                            onDragStart={() => editingId === null && setDragIndex(index)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => editingId === null && handleDrop(index)}
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
                                {editingId === position.id ? (
                                    <TextField
                                        size="small"
                                        value={editingName}
                                        onChange={(event) => setEditingName(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                savePositionName(position);
                                            }
                                            if (event.key === "Escape") {
                                                cancelEditing();
                                            }
                                        }}
                                        autoFocus
                                        sx={{ minWidth: 220 }}
                                    />
                                ) : (
                                    <Typography>{position.name}</Typography>
                                )}
                            </Stack>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <FormControlLabel
                                    control={
                                        <Switch
                                            size="small"
                                            checked={Boolean(position.required)}
                                            onChange={(event) => toggleRequired(position, event.target.checked)}
                                            disabled={updatingId === position.id || editingId === position.id}
                                        />
                                    }
                                    label={position.required ? "Required" : "Optional"}
                                    sx={{ mr: 0 }}
                                />
                                {editingId === position.id ? (
                                    <>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            onClick={() => savePositionName(position)}
                                            disabled={updatingId === position.id}
                                        >
                                            Save
                                        </Button>
                                        <Button size="small" variant="outlined" onClick={cancelEditing}>
                                            Cancel
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => startEditing(position)}
                                    >
                                        Edit
                                    </Button>
                                )}
                                <Button
                                    size="small"
                                    color="error"
                                    onClick={() => removePosition(position.id)}
                                    disabled={editingId === position.id}
                                >
                                    Delete
                                </Button>
                            </Stack>
                        </Box>
                    ))}
                </Stack>
            </Box>
        </PageShell>
    );
}

export default Positions;
