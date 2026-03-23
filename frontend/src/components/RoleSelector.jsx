import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

function RoleSelector({ activeRoleId, disabled = false, label = "Role", roles, onChange }) {
    if (!roles || roles.length <= 1) {
        return null;
    }

    return (
        <TextField
            select
            label={label}
            value={activeRoleId ? String(activeRoleId) : ""}
            onChange={(event) => onChange(Number(event.target.value))}
            disabled={disabled}
            sx={{ minWidth: 220 }}
        >
            {roles.map((role) => (
                <MenuItem key={role.id} value={String(role.id)}>
                    {role.name}
                </MenuItem>
            ))}
        </TextField>
    );
}

export default RoleSelector;