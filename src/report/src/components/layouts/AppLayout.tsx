import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { Loader2 } from "lucide-react";

export function Applayout() {
    const location = useLocation();

    return (
        <>
            <Header />
            <div className="flex-grow flex flex-col">
                <main key={location.pathname} className="container max-w-6xl px-4 md:px-8 flex-grow flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <Suspense fallback={
                        <div className="flex-grow flex items-center justify-center min-h-[400px]">
                            <div className="flex flex-col items-center gap-4 text-muted-foreground">
                                <Loader2 className="size-8 animate-spin text-primary opacity-50" />
                                <span className="text-sm font-medium tracking-wide animate-pulse">Loading dashboard modules...</span>
                            </div>
                        </div>
                    }>
                        <Outlet />
                    </Suspense>
                </main>
            </div>
            <div className="container max-w-6xl px-4 md:px-8">
                <Footer />
            </div>
        </>
    )
}
