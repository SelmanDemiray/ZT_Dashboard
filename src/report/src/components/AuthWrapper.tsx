import { useEffect } from "react";
import { useMsal, MsalAuthenticationTemplate } from "@azure/msal-react";
import { InteractionType } from "@azure/msal-browser";
import { useNavigate } from "react-router-dom";
import { CustomNavigationClient } from "../utils/CustomNavigationClient";
import { Loader2, ShieldAlert } from "lucide-react";

const ErrorComponent = ({ error }: { error: any }) => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground relative overflow-hidden">
        <div className="bg-mesh-container absolute inset-0 -z-10">
            <div className="bg-mesh-orb-1" />
            <div className="bg-mesh-orb-2" />
        </div>
        <ShieldAlert className="size-16 text-destructive mb-6 shadow-sm drop-shadow-md" />
        <h1 className="text-3xl font-extrabold tracking-tight mb-3">Authentication Failed</h1>
        <p className="text-lg text-muted-foreground max-w-md text-center">
            {error ? error.message : "An unknown error occurred during sign-in. Your session may have expired."}
        </p>
    </div>
);

const LoadingComponent = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground relative overflow-hidden">
        <div className="bg-mesh-container absolute inset-0 -z-10 opacity-70">
            <div className="bg-mesh-orb-1 opacity-50" />
            <div className="bg-mesh-orb-2 opacity-50" />
        </div>
        <Loader2 className="size-14 animate-spin text-primary opacity-80 mb-6 drop-shadow-sm" />
        <h2 className="text-2xl font-semibold tracking-wide animate-pulse bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
            Securing Zero Trust session...
        </h2>
        <p className="mt-4 text-muted-foreground text-sm font-medium">Verifying Enterprise identity</p>
    </div>
);

export function AuthWrapper({ children }: { children: React.ReactNode }) {
    const { instance } = useMsal();
    const navigate = useNavigate();

    useEffect(() => {
        const navigationClient = new CustomNavigationClient(navigate);
        instance.setNavigationClient(navigationClient);
    }, [instance, navigate]);

    return (
        <MsalAuthenticationTemplate
            interactionType={InteractionType.Redirect}
            errorComponent={ErrorComponent}
            loadingComponent={LoadingComponent}
        >
            {children}
        </MsalAuthenticationTemplate>
    );
}
