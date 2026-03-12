async function readJson(response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

export async function getCurrentUser() {
    const response = await fetch("/api/me", {
        credentials: "include",
    });

    const data = await response.json().catch(() => ({ user: null }));
    return data.user || null;
}

export async function login(email, password) {
    const response = await fetch("/api/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password }),
    });

    const data = await readJson(response);
    return data.user;
}

export async function register(name, email, password, type) {
    const response = await fetch("/api/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ name, email, password, type }),
    });

    const data = await readJson(response);
    return data.user;
}

export async function logout() {
    const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
    });

    return readJson(response);
}
