import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { getUsers, updateUser } from "../api/ministry";
import PageShell from "../components/PageShell";

const USER_TYPES = ["Deacon", "Pastor", "Yokefellow", "Other"];

function UsersManagement() {
    const [users, setUsers] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [sortBy, setSortBy] = useState("name");
    const [sortDirection, setSortDirection] = useState("asc");
    const [form, setForm] = useState({
        email: "",
        name: "",
        type: "Other",
    });

    async function loadUsers() {
        setLoading(true);
        setError("");

        try {
            const data = await getUsers();
            setUsers(data);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadUsers();
    }, []);

    const selectedUser = useMemo(
        () => users.find((user) => user.id === editingId) || null,
        [users, editingId],
    );

    const sortedUsers = useMemo(() => {
        return [...users].sort((left, right) => {
            const leftValue = String(left[sortBy] || "").toLowerCase();
            const rightValue = String(right[sortBy] || "").toLowerCase();

            if (leftValue === rightValue) {
                return 0;
            }

            const comparison = leftValue.localeCompare(rightValue);
            return sortDirection === "asc" ? comparison : -comparison;
        });
    }, [sortBy, sortDirection, users]);

    function beginEdit(user) {
        setEditingId(user.id);
        setForm({
            email: user.email || "",
            name: user.name || "",
            type: user.type || "Other",
        });
    }

    function clearEdit() {
        setEditingId(null);
        setForm({ email: "", name: "", type: "Other" });
    }

    function handleSort(column) {
        if (sortBy === column) {
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
            return;
        }

        setSortBy(column);
        setSortDirection("asc");
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!editingId) {
            return;
        }

        setSaving(true);
        setError("");

        try {
            await updateUser(editingId, {
                email: form.email,
                name: form.name,
                type: form.type,
            });
            await loadUsers();
            clearEdit();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <PageShell
            eyebrow="Admin"
            title="Users Management"
            description="View all users and edit name, email, and type. No pagination is applied to this table."
        >
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

            {editingId ? (
                <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                    <Typography variant="h5">Edit User</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Editing user #{editingId}
                    </Typography>
                    <TextField
                        label="Name"
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        required
                    />
                    <TextField
                        label="Email"
                        type="email"
                        value={form.email}
                        onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                        required
                    />
                    <TextField
                        select
                        label="Type"
                        value={form.type}
                        onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                        required
                    >
                        {USER_TYPES.map((type) => (
                            <MenuItem key={type} value={type}>
                                {type}
                            </MenuItem>
                        ))}
                    </TextField>
                    <Stack direction="row" spacing={1}>
                        <Button type="submit" variant="contained" disabled={saving}>
                            {saving ? "Saving..." : "Save user"}
                        </Button>
                        <Button type="button" variant="outlined" onClick={clearEdit}>
                            Cancel
                        </Button>
                    </Stack>
                </Box>
            ) : null}

            {loading ? <Typography>Loading users...</Typography> : null}

            <TableContainer className="hero-card" sx={{ overflowX: "auto" }}>
                <Table size="small" aria-label="users table">
                    <TableHead>
                        <TableRow>
                            <TableCell sortDirection={sortBy === "name" ? sortDirection : false}>
                                <TableSortLabel
                                    active={sortBy === "name"}
                                    direction={sortBy === "name" ? sortDirection : "asc"}
                                    onClick={() => handleSort("name")}
                                >
                                    Name
                                </TableSortLabel>
                            </TableCell>
                            <TableCell sortDirection={sortBy === "email" ? sortDirection : false}>
                                <TableSortLabel
                                    active={sortBy === "email"}
                                    direction={sortBy === "email" ? sortDirection : "asc"}
                                    onClick={() => handleSort("email")}
                                >
                                    Email
                                </TableSortLabel>
                            </TableCell>
                            <TableCell sortDirection={sortBy === "type" ? sortDirection : false}>
                                <TableSortLabel
                                    active={sortBy === "type"}
                                    direction={sortBy === "type" ? sortDirection : "asc"}
                                    onClick={() => handleSort("type")}
                                >
                                    Type
                                </TableSortLabel>
                            </TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedUsers.map((user) => (
                            <TableRow
                                key={user.id}
                                selected={selectedUser?.id === user.id}
                                hover
                            >
                                <TableCell>{user.name || "-"}</TableCell>
                                <TableCell>{user.email}</TableCell>
                                <TableCell>{user.type}</TableCell>
                                <TableCell align="right">
                                    <Button size="small" variant="outlined" onClick={() => beginEdit(user)}>
                                        Edit
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </PageShell>
    );
}

export default UsersManagement;
