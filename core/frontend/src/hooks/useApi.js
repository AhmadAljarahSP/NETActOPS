import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "../store/useStore";

const API_BASE = "/api";

async function apiFetch(endpoint, options = {}) {
    const apiKey = useStore.getState().apiKey;

    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey || "",
        ...options.headers,
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (res.status === 401) {
        useStore.getState().setAuthenticated(false);
        throw new Error("Unauthorized");
    }

    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(error.detail || "Request failed");
    }

    return res.json();
}

export function useDashboardData() {
    return useQuery({
        queryKey: ["dashboard"],
        queryFn: () => apiFetch("/dashboard/stats"),
        refetchInterval: 30000,
    });
}

export function useDevices(group) {
    const endpoint = group ? `/devices?group=${group}` : "/devices";
    return useQuery({
        queryKey: ["devices", group],
        queryFn: () => apiFetch(endpoint),
    });
}

export function useDeviceGroups() {
    return useQuery({
        queryKey: ["device-groups"],
        queryFn: () => apiFetch("/device-groups"),
    });
}

export function useDeviceTypes() {
    return useQuery({
        queryKey: ["device-types"],
        queryFn: () => apiFetch("/device-types"),
    });
}

export function useBackups(deviceId) {
    return useQuery({
        queryKey: ["backups", deviceId],
        queryFn: () => apiFetch(`/backups/${deviceId}`),
        enabled: !!deviceId,
    });
}

export function useFullConfig(backupId, deviceId) {
    return useQuery({
        queryKey: ["fullConfig", backupId, deviceId],
        queryFn: () => apiFetch(`/backups/${backupId}/full?device_id=${deviceId}`),
        enabled: !!backupId && !!deviceId,
    });
}

export function useBackupDevice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ deviceId, commandSource }) => {
            const url = commandSource
                ? `/backup/${deviceId}?commands_source_path=${encodeURIComponent(commandSource)}`
                : `/backup/${deviceId}`;
            return apiFetch(url, { method: "POST" });
        },
        onSuccess: (data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["backups", variables.deviceId] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
    });
}

export function useBatchBackup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ deviceIds, commandSource }) => {
            const params = new URLSearchParams();
            deviceIds.forEach(id => params.append("device_ids", id));
            if (commandSource) params.append("commands_source_path", commandSource);

            return apiFetch(`/backup/group?${params.toString()}`, { method: "POST" });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["backups"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
    });
}

export function useDeleteDevice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (deviceId) => apiFetch(`/devices/${deviceId}`, { method: "DELETE" }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
    });
}

export function useAddDevice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (device) =>
            apiFetch("/devices", {
                method: "POST",
                body: JSON.stringify(device),
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
    });
}

export function useReloadDevices() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => apiFetch("/devices/reload", { method: "POST" }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
    });
}

export function useExportExcel() {
    return useMutation({
        mutationFn: async () => {
            const apiKey = useStore.getState().apiKey;
            const res = await fetch(`${API_BASE}/devices/export-excel`, {
                headers: { "x-api-key": apiKey || "" },
            });
            if (!res.ok) throw new Error("Export failed");
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "network-devices.xlsx";
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        },
    });
}

export function useImportExcel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (file) => {
            const formData = new FormData();
            formData.append("file", file);

            const apiKey = useStore.getState().apiKey;
            const res = await fetch(`${API_BASE}/devices/import-excel`, {
                method: "POST",
                headers: { "x-api-key": apiKey || "" },
                body: formData,
            });

            if (!res.ok) throw new Error("Import failed");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
    });
}

export function useCompareConfigs(deviceId, backup1, backup2) {
    return useQuery({
        queryKey: ["compare", deviceId, backup1, backup2],
        queryFn: () =>
            apiFetch(
                `/backups/${deviceId}/compare?backup1=${backup1}&backup2=${backup2}`
            ),
        enabled: !!deviceId && !!backup1 && !!backup2,
    });
}