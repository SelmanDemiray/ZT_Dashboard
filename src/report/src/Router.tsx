import { createHashRouter } from "react-router-dom";

import { Applayout } from "./components/layouts/AppLayout";
import { AuthWrapper } from "./components/AuthWrapper";

import { lazy } from "react";

const NoMatch = lazy(() => import("./pages/NoMatch"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Storage = lazy(() => import("./pages/Storage"));
const VmsContainers = lazy(() => import("./pages/VmsContainers"));
const Networks = lazy(() => import("./pages/Networks"));
const FinOps = lazy(() => import("./pages/FinOps"));
const Trends = lazy(() => import("./pages/Trends"));
const Settings = lazy(() => import("./pages/Settings"));

export const router = createHashRouter([
    {
        path: "/",
        element: (
            <AuthWrapper>
                <Applayout />
            </AuthWrapper>
        ),
        children: [
            {
                path: "",
                element: <Dashboard />,
            },
            {
                path: "storage",
                element: <Storage />,
            },
            {
                path: "vms-containers",
                element: <VmsContainers />,
            },
            {
                path: "networks",
                element: <Networks />,
            },
            {
                path: "finops",
                element: <FinOps />,
            },
            {
                path: "trends",
                element: <Trends />,
            },
            {
                path: "settings",
                element: <Settings />,
            },
        ],
    },
    {
        path: "*",
        element: <NoMatch />,
    },
], {
    basename: global.basename
})
