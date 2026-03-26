import { NavigationClient } from "@azure/msal-browser";
import { useNavigate } from "react-router-dom";

/**
 * This is a custom navigation client that allows MSAL to use React Router's navigate function
 * instead of doing a full page reload via window.location.assign. This ensures a seamless,
 * professional SPA experience without flashing or losing application state.
 */
export class CustomNavigationClient extends NavigationClient {
    private navigate: ReturnType<typeof useNavigate>;

    constructor(navigate: ReturnType<typeof useNavigate>) {
        super();
        this.navigate = navigate;
    }

    async navigateInternal(url: string, options: any) {
        const relativePath = url.replace(window.location.origin, "");
        if (options.noHistory) {
            this.navigate(relativePath, { replace: true });
        } else {
            this.navigate(relativePath);
        }
        return false;
    }
}
