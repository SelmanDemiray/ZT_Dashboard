import { createHashRouter } from "react-router-dom";

import { Applayout } from "./components/layouts/AppLayout";

import { lazy } from "react";

const NoMatch = lazy(() => import("./pages/NoMatch"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Identity = lazy(() => import("./pages/Identity"));
const Devices = lazy(() => import("./pages/Devices"));
const Apps = lazy(() => import("./pages/Apps"));
const Network = lazy(() => import("./pages/Network"));
const Infrastructure = lazy(() => import("./pages/Infrastructure"));
const Data = lazy(() => import("./pages/Data"));
const Trends = lazy(() => import("./pages/Trends"));

export const router = createHashRouter([
    {
        path: "/",
        element: <Applayout />,
        children: [
            {
                path: "",
                element: <Dashboard />,
            },
            {
                path: "identity",
                element: <Identity />,
            },
            {
                path: "devices",
                element: <Devices />,
            },
            {
                path: "apps",
                element: <Apps />,
            },
            {
                path: "network",
                element: <Network />,
            },
            {
                path: "infrastructure",
                element: <Infrastructure />,
            },
            {
                path: "data",
                element: <Data />,
            },
            {
                path: "trends",
                element: <Trends />,
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
