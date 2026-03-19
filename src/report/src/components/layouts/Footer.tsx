import React, { useMemo } from "react";
import { Icons } from "../icons";
import { useGlobalFilters } from "@/contexts/GlobalFilterContext";
// import { ztAppConfig } from "@/config/app";
// import { ModeToggle } from "../mode-toggle";

export const Footer = React.memo(function Footer() {
    const { reportData } = useGlobalFilters();
    
    // Format the assessment date, memoized to prevent recalculation
    const assessmentDate = useMemo(() => {
        if (!reportData.ExecutedAt) return 'Not Available';
        try {
            return new Date(reportData.ExecutedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return 'Invalid Date';
        }
    }, [reportData.ExecutedAt]);

    return (
        <footer role="contentinfo" className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                    {/* Left Section - About */}
                    <div className="space-y-4">
                        <div className="flex items-center space-x-2">
                            <Icons.logo className="h-6 w-6" />
                            <span className="font-semibold text-foreground">Zero Trust Assessment</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            An automated assessment tool that evaluates your Microsoft tenant's zero trust security posture.
                        </p>
                    </div>

                    {/* Center Section - Links */}
                    <nav aria-label="Resources" className="space-y-4">
                        <h4 className="font-semibold text-foreground">Resources</h4>
                        <div className="space-y-2">
                            <a
                                href="https://aka.ms/zerotrust/assessment"
                                target="_blank"
                                rel="noreferrer noopener"
                                className="block text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 hover:underline underline-offset-4"
                            >
                                Zero Trust Assessment
                            </a>
                            <a
                                href="https://aka.ms/zerotrust/workshop"
                                target="_blank"
                                rel="noreferrer noopener"
                                className="block text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 hover:underline underline-offset-4"
                            >
                                Zero Trust Workshop
                            </a>
                        </div>
                    </nav>

                    {/* Right Section - Support */}
                    <nav aria-label="Support links" className="space-y-4">
                        <h4 className="font-semibold text-foreground">Support</h4>
                        <div className="space-y-2">
                            <a
                                href="https://aka.ms/zerotrust/feedback"
                                target="_blank"
                                rel="noreferrer noopener"
                                className="block text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 hover:underline underline-offset-4"
                            >
                                Share Feedback
                            </a>
                            <a
                                href="https://aka.ms/zerotrust/issues"
                                target="_blank"
                                rel="noreferrer noopener"
                                className="block text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 hover:underline underline-offset-4"
                            >
                                Report Issues
                            </a>
                            <a
                                href="https://github.com/microsoft/zerotrustassessment"
                                target="_blank"
                                rel="noreferrer noopener"
                                className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 hover:underline underline-offset-4"
                            >
                                <Icons.gitHub className="h-4 w-4" />
                                <span>GitHub</span>
                            </a>
                        </div>
                    </nav>
                </div>

                {/* Bottom Section - Copyright and Legal */}
                <div className="border-t mt-8 pt-6 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                    <div className="text-center md:text-left">
                        <p className="text-xs text-muted-foreground">
                            © {new Date().getFullYear()} Microsoft Corporation. All rights reserved.
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            This is a community project and not an official Microsoft product.
                        </p>
                    </div>

                    <nav aria-label="Legal links" className="flex items-center space-x-4 text-xs text-muted-foreground">
                        <a
                            href="https://privacy.microsoft.com/privacystatement"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hover:text-foreground transition-colors duration-200"
                        >
                            Privacy
                        </a>
                        <span>•</span>
                        <a
                            href="https://www.microsoft.com/legal/terms-of-use"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hover:text-foreground transition-colors duration-200"
                        >
                            Terms
                        </a>
                        <span aria-hidden="true">•</span>
                        <span>{assessmentDate}</span>
                    </nav>

                    {/* Theme Toggle (Hidden but available for future use) */}
                    <div className="hidden">
                        {/* Show LightTheme by default and disable toggle. Charts don't render well in dark mode. */}
                        {/* <ModeToggle /> */}
                    </div>
                </div>
            </div>
        </footer>
    )
})
