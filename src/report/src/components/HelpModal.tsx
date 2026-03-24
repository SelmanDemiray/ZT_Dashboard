import { useState } from "react";
import { QuestionMarkCircledIcon, InfoCircledIcon, LockClosedIcon, MagnifyingGlassIcon, Component1Icon, GlobeIcon, ListBulletIcon, ArrowRightIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function HelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="w-9 h-9 px-0 rounded-full" aria-label="Help and Information">
          <QuestionMarkCircledIcon className="h-[1.2rem] w-[1.2rem] text-muted-foreground hover:text-foreground transition-colors" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] w-[95vw] max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl rounded-xl">
        <div className="px-6 py-5 border-b shrink-0 bg-muted/20">
          <DialogTitle className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <InfoCircledIcon className="w-6 h-6 text-primary" />
            Zero Trust Assessment Guide
          </DialogTitle>
          <DialogDescription className="text-[15px] text-muted-foreground mt-2 leading-relaxed">
            Everything you need to know about navigating your environment, how metrics are determined, and the technical mechanisms powering this dashboard.
          </DialogDescription>
        </div>

        <Tabs defaultValue="guide" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-2 pb-0 border-b shrink-0 bg-muted/5">
            <TabsList className="w-full justify-start h-auto p-1 bg-muted/50 rounded-lg">
              <TabsTrigger value="guide" className="text-sm py-2 px-4 rounded-md data-[state=active]:shadow-sm">Welcome & Guide</TabsTrigger>
              <TabsTrigger value="scoring" className="text-sm py-2 px-4 rounded-md data-[state=active]:shadow-sm">Scoring & Metrics</TabsTrigger>
              <TabsTrigger value="technical" className="text-sm py-2 px-4 rounded-md data-[state=active]:shadow-sm">Data & Endpoints</TabsTrigger>
              <TabsTrigger value="advice" className="text-sm py-2 px-4 rounded-md data-[state=active]:shadow-sm">Best Practices</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto w-full px-6 py-6 smooth-scroll custom-scrollbar">
            
            {/* Guide Tab */}
            <TabsContent value="guide" className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-foreground">Welcome to the Dashboard</h3>
                <p className="text-muted-foreground leading-relaxed">
                  If you are new here, this tool provides a comprehensive, unified view of your organization's security posture and financial footprint across your Microsoft 365 and Azure environment. It is designed to be highly interactive—allowing you to filter data globally by tenant, scope, or operational area.
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-bold text-foreground border-b pb-2">Navigating the Menus</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="bg-muted/30 p-5 rounded-xl border border-border/50 hover:bg-muted/50 transition-colors shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-base">
                      <Component1Icon className="w-5 h-5 text-blue-500" />
                      Overview
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">The high-level summary of your security compliance. Includes at-a-glance metrics for Identity, Devices, and Governance.</p>
                  </div>
                  <div className="bg-muted/30 p-5 rounded-xl border border-border/50 hover:bg-muted/50 transition-colors shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-base">
                      <LockClosedIcon className="w-5 h-5 text-indigo-500" />
                      Storage
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">Visibility into all your Azure Storage Accounts, evaluating their encryption, TLS enforcement, and network access policies.</p>
                  </div>
                  <div className="bg-muted/30 p-5 rounded-xl border border-border/50 hover:bg-muted/50 transition-colors shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-base">
                      <GlobeIcon className="w-5 h-5 text-emerald-500" />
                      Networks, VMs & Containers
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">Dive deep into your network security configurations, virtual machine baselines, and container protections.</p>
                  </div>
                  <div className="bg-muted/30 p-5 rounded-xl border border-border/50 hover:bg-muted/50 transition-colors shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-base">
                      <svg className="w-5 h-5 text-amber-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                      FinOps
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">Track financial operations, identifying cost trends, anomalies, and actionable recommendations for architectural savings.</p>
                  </div>
                  <div className="bg-muted/30 p-5 rounded-xl border border-border/50 hover:bg-muted/50 transition-colors shadow-sm sm:col-span-2">
                    <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-base">
                      <ListBulletIcon className="w-5 h-5 text-rose-500" />
                      Trends & Settings
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">Use <strong>Trends</strong> to view historical score tracking over time. Use <strong>Settings</strong> to configure global filters and map scopes securely.</p>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Scoring Tab */}
            <TabsContent value="scoring" className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
               <div className="space-y-5">
                  <h3 className="text-lg font-bold text-foreground border-b pb-2">How Scores are Derived</h3>
                  <p className="text-muted-foreground leading-relaxed text-[15px]">
                    The overall Zero Trust Assessment score is effectively a measure of <strong>compliance percentage</strong> against recommended continuous-verification baselines.
                  </p>
                  <div className="bg-background rounded-xl p-6 border shadow-sm flex items-center justify-center">
                    <p className="font-mono text-base text-foreground flex flex-wrap items-center justify-center gap-3">
                      <span className="font-semibold text-lg">Score (%) = </span>
                      <span className="bg-primary/10 text-primary px-3 py-1.5 rounded-md font-semibold">Passed Checks</span>
                      <span className="text-muted-foreground text-lg">/</span>
                      <span className="bg-muted px-3 py-1.5 rounded-md border font-medium text-muted-foreground">Total Applicable Checks</span>
                      <span className="font-semibold text-lg">× 100</span>
                    </p>
                  </div>
                  <div className="space-y-4 pt-2">
                    <h4 className="font-semibold text-foreground">Areas Evaluated:</h4>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      <li className="bg-muted/30 p-4 rounded-lg border">
                        <strong className="text-foreground block mb-1">Identity Core</strong> 
                        <span className="text-sm text-muted-foreground block">Evaluates overarching MFA enforcement, Legacy Authentication blocks, and Risk-based Conditional Access policies.</span>
                      </li>
                      <li className="bg-muted/30 p-4 rounded-lg border">
                        <strong className="text-foreground block mb-1">Device Health</strong> 
                        <span className="text-sm text-muted-foreground block">Checks Intune enrollment footprint, device compliance strictness, and Defender for Endpoint integration metrics.</span>
                      </li>
                      <li className="bg-muted/30 p-4 rounded-lg border sm:col-span-2">
                        <strong className="text-foreground block mb-1">Data & Governance</strong> 
                        <span className="text-sm text-muted-foreground block">Reviews highly privileged administrative accounts, over-permissioned enterprise apps, and the prevalence of stale or inactive accounts.</span>
                      </li>
                    </ul>
                  </div>
                  <div className="flex gap-4 p-5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-400 shadow-sm mt-4">
                    <InfoCircledIcon className="w-6 h-6 shrink-0 mt-0.5" />
                    <p className="text-[14.5px] leading-relaxed">
                      <strong>Note:</strong> Some security checks naturally carry higher severity weights. Critical failures (such as missing Global Admin MFA) often cap your maximum attainable score until completely resolved, regardless of other passing checks.
                    </p>
                  </div>
               </div>
            </TabsContent>

            {/* Technical Tab */}
            <TabsContent value="technical" className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
               <div className="space-y-4">
                <h3 className="text-lg font-bold text-foreground border-b pb-2">Architecture & Setup</h3>
                <p className="text-muted-foreground text-[15px] leading-relaxed">
                  This frontend dashboard is completely <strong>read-only and static</strong>. It never accesses your live tenant directly, meaning no credentials, client secrets, or user tokens are ever exposed to the web browser. 
                </p>
                <div className="relative pl-8 space-y-6 border-l w-full border-primary/30 ml-3 py-4">
                  <div className="relative">
                    <div className="absolute -left-[45px] top-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center border border-primary/50 text-sm font-bold text-primary shadow-sm">1</div>
                    <strong className="text-foreground block mb-1 text-base">Data Collection via Runbooks</strong>
                    <p className="text-[14.5px] leading-relaxed text-muted-foreground">Scheduled Azure Automation Runbooks (e.g., <code className="bg-muted px-1.5 py-0.5 rounded border text-xs text-foreground">Verify-ZtAssessmentData.ps1</code>) run in your environment securely utilizing a system Managed Identity.</p>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-[45px] top-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center border border-primary/50 text-sm font-bold text-primary shadow-sm">2</div>
                    <strong className="text-foreground block mb-1 text-base">Data Transformation & Sanitization</strong>
                    <p className="text-[14.5px] leading-relaxed text-muted-foreground">The PowerShell logic issues asynchronous queries to Microsoft Graph API and Azure Resource Graph to evaluate your compliance against defined security baselines.</p>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-[45px] top-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center border border-primary/50 text-sm font-bold text-primary shadow-sm">3</div>
                    <strong className="text-foreground block mb-1 text-base">JSON Blob Exports</strong>
                    <p className="text-[14.5px] leading-relaxed text-muted-foreground">The script ultimately writes structured, anonymized JSON artifacts (such as FinOps trends, Assessment scores, Storage topologies) securely into Azure Blob Storage blocks, which this frontend then seamlessly consumes.</p>
                  </div>
                </div>
               </div>

               <div className="space-y-4 pt-2">
                  <h3 className="text-lg font-bold text-foreground border-b pb-2">APIs & Endpoints Utilized</h3>
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="graph" className="border rounded-xl mb-3 px-5 bg-muted/10 shadow-sm overflow-hidden">
                      <AccordionTrigger className="hover:no-underline py-4">
                        <span className="font-semibold text-foreground flex items-center gap-3"><GlobeIcon className="w-5 h-5 text-blue-500"/> Microsoft Graph API (App-Only)</span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-5 space-y-3">
                        <p className="text-sm text-muted-foreground">Used extensively for Identity, Devices, and Governance evaluation. Keys endpoints requested by the backend worker include:</p>
                        <ul className="space-y-2 font-mono text-[13px] overflow-x-auto text-muted-foreground p-4 bg-muted/40 rounded-lg border shadow-inner">
                          <li className="flex gap-2"><span className="text-green-600 font-bold">GET</span> /beta/policies/mobileDeviceManagementPolicies</li>
                          <li className="flex gap-2"><span className="text-green-600 font-bold">GET</span> /beta/deviceManagement/deviceEnrollmentConfigurations</li>
                          <li className="flex gap-2"><span className="text-green-600 font-bold">GET</span> /beta/deviceManagement/deviceCompliancePolicies</li>
                          <li className="flex gap-2"><span className="text-green-600 font-bold">GET</span> /beta/deviceAppManagement/managedAppPolicies</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="arg" className="border rounded-xl mb-3 px-5 bg-muted/10 shadow-sm overflow-hidden">
                      <AccordionTrigger className="hover:no-underline py-4">
                        <span className="font-semibold text-foreground flex items-center gap-3"><MagnifyingGlassIcon className="w-5 h-5 text-purple-500"/> Azure Resource Graph (ARG)</span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-5 space-y-3">
                        <p className="text-sm text-muted-foreground">High performance Kusto queries executed across subscriptions at scale to collect platform metrics without rate limiting:</p>
                        <div className="space-y-3">
                          <div className="p-4 bg-muted/40 rounded-lg border shadow-inner text-sm font-mono text-muted-foreground">
                            <span className="text-primary font-bold block mb-1"># Storage Accounts Inventory</span>
                            Resources | where type =~ 'microsoft.storage/storageaccounts'
                          </div>
                          <div className="p-4 bg-muted/40 rounded-lg border shadow-inner text-sm font-mono text-muted-foreground">
                            <span className="text-primary font-bold block mb-1"># Unified Azure Policies Mapping</span>
                            policyresources | where type =~ 'microsoft.authorization/policydefinitions'
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="auth" className="border rounded-xl px-5 bg-muted/10 shadow-sm overflow-hidden">
                      <AccordionTrigger className="hover:no-underline py-4">
                        <span className="font-semibold text-foreground flex items-center gap-3"><LockClosedIcon className="w-5 h-5 text-amber-500"/> Token & Control Endpoints</span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-5">
                        <ul className="list-disc pl-5 text-[14.5px] leading-relaxed text-muted-foreground space-y-3 marker:text-primary">
                          <li><strong className="text-foreground">Azure IMDS:</strong> <code className="text-xs bg-background border px-1.5 py-0.5 rounded">http://169.254.169.254/metadata/identity/oauth2/token</code> - Used by the runbook worker to implicitly authenticate via Managed Identity.</li>
                          <li><strong className="text-foreground">Azure Management:</strong> <code className="text-xs bg-background border px-1.5 py-0.5 rounded">https://management.azure.com</code> - Core ARM interactions.</li>
                          <li><strong className="text-foreground">Blob Storage:</strong> <code className="text-xs bg-background border px-1.5 py-0.5 rounded">https://[account].blob.core.windows.net</code> - The final destination for the rendered JSON artifacts.</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
               </div>
            </TabsContent>

            {/* Advice Tab */}
            <TabsContent value="advice" className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-foreground border-b pb-2">Best Practices & Rapid Improvements</h3>
                <p className="text-muted-foreground text-[15px] leading-relaxed">
                  If you are overwhelmed by the metrics presented, the absolute fastest way to systematically improve your Zero Trust posture is to focus exclusively on these high-impact remediation areas first:
                </p>
                
                <div className="grid gap-4 mt-4">
                  <div className="flex gap-5 p-5 rounded-2xl border shadow-sm bg-muted/20 hover:bg-muted/40 transition-all hover:shadow-md">
                    <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center shrink-0 border border-green-500/20 shadow-sm">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div>
                      <strong className="text-foreground block text-base mb-1">Enforce Phishing-Resistant MFA</strong>
                      <p className="text-[14.5px] leading-relaxed text-muted-foreground">Move away from SMS/Voice based MFA to Authenticator App, FIDO2, or Windows Hello for Business for all critical administrative users. Passwords alone are not sufficient.</p>
                    </div>
                  </div>

                  <div className="flex gap-5 p-5 rounded-2xl border shadow-sm bg-muted/20 hover:bg-muted/40 transition-all hover:shadow-md">
                    <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center shrink-0 border border-green-500/20 shadow-sm">
                       <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div>
                      <strong className="text-foreground block text-base mb-1">Block Legacy Authentication</strong>
                      <p className="text-[14.5px] leading-relaxed text-muted-foreground">Ensure Conditional Access blocks out-of-date protocols that completely bypass modern authentication mechanisms and multifactor challenges (like IMAP, POP3, and Authenticated SMTP).</p>
                    </div>
                  </div>

                  <div className="flex gap-5 p-5 rounded-2xl border shadow-sm bg-muted/20 hover:bg-muted/40 transition-all hover:shadow-md">
                    <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center shrink-0 border border-green-500/20 shadow-sm">
                       <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div>
                      <strong className="text-foreground block text-base mb-1">Require Device Compliance</strong>
                      <p className="text-[14.5px] leading-relaxed text-muted-foreground">Guarantee that sensitive access is only granted to endpoints strictly registered and marked as compliant inside Intune and MDM, blocking unmanaged BYOD setups from accessing privileged data.</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-8 pb-3">
                  <Button onClick={() => setOpen(false)} size="lg" className="gap-2 px-8 shadow-md hover:shadow-lg transition-all rounded-full font-semibold">
                    Got it, Close Guide <ArrowRightIcon className="w-4 h-4"/>
                  </Button>
                </div>
              </div>
            </TabsContent>

          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
