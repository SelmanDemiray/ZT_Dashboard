import { RouterProvider } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { GlobalFilterProvider } from "./contexts/GlobalFilterContext";
import { SettingsProvider } from "./contexts/SettingsContext";
import { router } from "./Router";
import { Toaster } from "./components/ui/sonner";
import { useDemoToast } from "./hooks/useDemoToast";

export default function App() {
    useDemoToast();

    return (
        <ThemeProvider defaultTheme="system">
            <SettingsProvider>
                <GlobalFilterProvider>
                    <RouterProvider router={router} />
                    <Toaster position="top-center" richColors />
                </GlobalFilterProvider>
            </SettingsProvider>
        </ThemeProvider>
    )
}
