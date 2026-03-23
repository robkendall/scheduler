import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { createRole, deleteRole, getRoles, updateRole } from "../api/scheduler";
import PageShell from "../components/PageShell";
import { formatDisplayDate } from "../utils/date";

function Roles() {
    const [roles, setRoles] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [name, setName] = useState("");

    async function loadRoles() {
        setLoading(true);
        setError("");

        try {
            const data = await getRoles();
            setRoles(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadRoles();
    }, []);

    const sortedRoles = useMemo(
        () => [...roles].sort((left, right) => left.name.localeCompare(right.name)),
        [roles],
    );

    function beginEdit(role) {
        setEditingId(role.id);
        setName(role.name);
    }

    function clearForm() {
        setEditingId(null);
        setName("");
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        try {
            if (editingId) {
                await updateRole(editingId, { name });
            } else {
                await createRole({ name });
            }

            clearForm();
            await loadRoles();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id) {
        setError("");

        try {
            await deleteRole(id);
            if (editingId === id) {
                clearForm();
            }
            await loadRoles();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <PageShell
            eyebrow="Admin"
            title="Roles"
            description="Create and maintain isolated scheduler roles. Each role has its own calendar, people, and positions."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                <Typography variant="h5">{editingId ? `Edit role #${editingId}` : "Create role"}</Typography>
                <TextField
                    label="Role name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                />
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}>
                        {saving ? "Saving..." : editingId ? "Save role" : "Create role"}
                    </Button>
                    {editingId ? (
                        <Button type="button" variant="outlined" onClick={clearForm}>
                            Cancel
                        </Button>
                    ) : null}
                </Stack>
            </Box>

            {loading ? <Typography>Loading roles...</Typography> : null}

            <TableContainer className="hero-card" sx={{ overflowX: "auto" }}>
                <Table size="small" aria-label="roles table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedRoles.map((role) => (
                            <TableRow key={role.id} hover selected={editingId === role.id}>
                                <TableCell>{role.name}</TableCell>
                                <TableCell>{formatDisplayDate(role.created_at)}</TableCell>
                                <TableCell align="right">
                                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                                        <Button size="small" variant="outlined" onClick={() => beginEdit(role)}>
                                            Edit
                                        </Button>
                                        <Button size="small" color="error" onClick={() => handleDelete(role.id)}>
                                            Delete
                                        </Button>
                                    </Stack>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </PageShell>
    );
}

export default Roles;