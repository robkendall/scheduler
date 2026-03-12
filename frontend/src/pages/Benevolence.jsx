import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
    createBenevolence,
    deleteBenevolence,
    getAssignableUsers,
    getBenevolence,
    updateBenevolence,
} from "../api/ministry";
import PageShell from "../components/PageShell";

function Benevolence() {
    const [items, setItems] = useState([]);
    const [users, setUsers] = useState([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({
        amount: "0",
        dateFilled: "",
        deaconUserId: "",
        isFilled: false,
        name: "",
        request: "",
        requestDate: "",
    });

    async function loadData() {
        setLoading(true);
        setError("");
        try {
            const [benevolence, assignableUsers] = await Promise.all([getBenevolence(), getAssignableUsers()]);
            setItems(benevolence);
            setUsers(assignableUsers);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        setSaving(true);
        setError("");

        const payload = {
            amount: Number(form.amount),
            dateFilled: form.dateFilled || null,
            deaconUserId: Number(form.deaconUserId),
            isFilled: form.isFilled,
            name: form.name,
            request: form.request,
            requestDate: form.requestDate,
        };

        try {
            if (editingId) {
                await updateBenevolence(editingId, payload);
            } else {
                await createBenevolence(payload);
            }
            setEditingId(null);
            setForm({
                amount: "0",
                dateFilled: "",
                deaconUserId: "",
                isFilled: false,
                name: "",
                request: "",
                requestDate: "",
            });
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSaving(false);
        }
    }

    function startEdit(item) {
        setEditingId(item.id);
        setForm({
            amount: String(item.amount),
            dateFilled: item.date_filled ? String(item.date_filled).slice(0, 10) : "",
            deaconUserId: String(item.deacon_user_id),
            isFilled: item.is_filled,
            name: item.name,
            request: item.request,
            requestDate: String(item.request_date).slice(0, 10),
        });
    }

    async function handleDelete(id) {
        try {
            await deleteBenevolence(id);
            await loadData();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    return (
        <PageShell
            eyebrow="Care"
            title="Benevolence"
            description="Track benevolence requests, amounts, fill status, and follow-up dates."
        >
            <Box component="form" className="hero-card form-stack" onSubmit={handleSubmit} sx={{ mb: 2 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField label="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
                <TextField label="Request" value={form.request} onChange={(e) => setForm((p) => ({ ...p, request: e.target.value }))} required multiline minRows={2} />
                <TextField label="Request Date" type="date" InputLabelProps={{ shrink: true }} value={form.requestDate} onChange={(e) => setForm((p) => ({ ...p, requestDate: e.target.value }))} required />
                <TextField label="Amount" type="number" inputProps={{ min: "0", step: "0.01" }} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} required />
                <TextField
                    select
                    label="Deacon / Yokefellow"
                    value={form.deaconUserId}
                    onChange={(event) => setForm((prev) => ({ ...prev, deaconUserId: event.target.value }))}
                    required
                >
                    {users.map((user) => (
                        <MenuItem key={user.id} value={String(user.id)}>
                            {user.name || user.email} ({user.email})
                        </MenuItem>
                    ))}
                </TextField>
                <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2">Filled</Typography>
                    <Switch checked={form.isFilled} onChange={(e) => setForm((p) => ({ ...p, isFilled: e.target.checked }))} />
                </Stack>
                <TextField label="Date Filled" type="date" InputLabelProps={{ shrink: true }} value={form.dateFilled} onChange={(e) => setForm((p) => ({ ...p, dateFilled: e.target.value }))} disabled={!form.isFilled} />
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving..." : editingId ? "Update" : "Add"}</Button>
                    {editingId ? <Button variant="outlined" onClick={() => setEditingId(null)}>Cancel edit</Button> : null}
                </Stack>
            </Box>

            {loading ? <Typography>Loading benevolence...</Typography> : null}
            <div className="grid-cards">
                {items.map((item) => (
                    <section key={item.id} className="route-card">
                        <div>
                            <Typography variant="h5">{item.name}</Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>{item.request_date} | ${item.amount}</Typography>
                            <Typography variant="body1" sx={{ mb: 1 }}>{item.request}</Typography>
                            <Typography variant="body2">Assigned: {item.deacon_email}</Typography>
                            <Typography variant="body2">Status: {item.is_filled ? "Filled" : "Open"}</Typography>
                        </div>
                        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                            <Button size="small" variant="outlined" onClick={() => startEdit(item)}>Edit</Button>
                            <Button size="small" color="error" variant="outlined" onClick={() => handleDelete(item.id)}>Remove</Button>
                        </Stack>
                    </section>
                ))}
            </div>
        </PageShell>
    );
}

export default Benevolence;
