import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useStore = create(
    persist(
        (set, get) => ({
            // Auth
            isAuthenticated: false,
            user: null,
            apiKey: "",

            // UI State
            theme: "dark",
            sidebarCollapsed: false,
            view: "dashboard",

            // Device Management
            selectedGroup: "",
            groupCommandSource: "",
            selectedDevice: null,
            searchQuery: "",

            // Batch Operations
            selectedForBatch: [],
            batchStatuses: {},

            // Filters
            filterDeviceType: "",
            filterVendor: "",
            filterProtocol: "",

            // Actions
            setAuthenticated: (value, user) =>
                set({ isAuthenticated: value, user: user || null }),

            setApiKey: (key) => set({ apiKey: key }),

            toggleTheme: () =>
                set((state) => ({
                    theme: state.theme === "dark" ? "light" : "dark"
                })),

            setTheme: (theme) => set({ theme }),

            toggleSidebar: () =>
                set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

            setView: (view) => set({ view }),

            setSelectedGroup: (group) => set({ selectedGroup: group }),

            setGroupCommandSource: (source) =>
                set({ groupCommandSource: source }),

            setSelectedDevice: (device) => set({ selectedDevice: device }),

            setSearchQuery: (query) => set({ searchQuery: query }),

            toggleBatch: (id) =>
                set((state) => {
                    const newSet = state.selectedForBatch.includes(id)
                        ? state.selectedForBatch.filter(x => x !== id)
                        : [...state.selectedForBatch, id];
                    return { selectedForBatch: newSet };
                }),

            selectAllBatch: (deviceIds) =>
                set((state) => {
                    if (state.selectedForBatch.length === deviceIds.length) {
                        return { selectedForBatch: [] };
                    }
                    return { selectedForBatch: [...deviceIds] };
                }),

            clearBatch: () => set({ selectedForBatch: [] }),

            setBatchStatus: (id, status) =>
                set((state) => ({
                    batchStatuses: { ...state.batchStatuses, [id]: status },
                })),

            setFilterDeviceType: (type) => set({ filterDeviceType: type }),
            setFilterVendor: (vendor) => set({ filterVendor: vendor }),
            setFilterProtocol: (protocol) => set({ filterProtocol: protocol }),

            resetFilters: () =>
                set({
                    filterDeviceType: "",
                    filterVendor: "",
                    filterProtocol: "",
                    searchQuery: "",
                }),
        }),
        {
            name: "netact-storage",
            partialize: (state) => ({
                isAuthenticated: state.isAuthenticated,
                apiKey: state.apiKey,
                theme: state.theme,
                sidebarCollapsed: state.sidebarCollapsed,
            }),
        }
    )
);