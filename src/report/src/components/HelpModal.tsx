import { useState } from "react";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function HelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="w-9 h-9 px-0 rounded-full" aria-label="Help and Information">
          <QuestionMarkCircledIcon className="h-[1.2rem] w-[1.2rem] text-muted-foreground hover:text-foreground transition-colors" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col p-6 sm:p-8 gap-0">
        <DialogHeader className="pb-4 border-b shrink-0">
          <DialogTitle className="text-2xl font-bold tracking-tight">Zero Trust Assessment Guide</DialogTitle>
          <DialogDescription className="text-base text-muted-foreground mt-2">
            Understand how your environment is evaluated, how scores are calculated, and how to improve your security posture.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 pr-2 -mr-2 smooth-scroll">
          <Accordion type="single" collapsible className="w-full space-y-4" defaultValue="item-1">
            {/* Score Calculations */}
            <AccordionItem value="item-1" className="border rounded-lg px-4 bg-muted/20 data-[state=open]:bg-muted/40 transition-colors">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <div className={cn(badgeVariants({ variant: "outline" }), "w-8 h-8 rounded-full flex items-center justify-center p-0")}>1</div>
                  <span className="font-semibold text-lg">How Scores are Calculated</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="text-base text-muted-foreground leading-relaxed pt-2 pb-4 space-y-4">
                <p>
                  The overall Zero Trust Assessment score is effectively a measure of <strong>compliance percentage</strong> against recommended identity, device, and governance baselines. 
                </p>
                <div className="bg-background rounded-md p-4 border shadow-sm">
                  <p className="font-mono text-sm text-foreground mb-2 flex flex-wrap items-center gap-2">
                    Score (%) = 
                    <span className="bg-primary/10 text-primary px-2 py-1 rounded">Passed Checks</span>
                    <span>/</span>
                    <span className="bg-muted px-2 py-1 rounded border">Total Applicable Checks</span>
                    <span>× 100</span>
                  </p>
                </div>
                <ul className="list-disc pl-5 space-y-2 marker:text-primary">
                  <li><strong>Identity:</strong> Evaluates MFA enforcement, legacy authentication blocks, and risk-based conditional access policies.</li>
                  <li><strong>Devices:</strong> Checks Intune enrollment, compliance policies, and Defender for Endpoint integration metrics.</li>
                  <li><strong>Data & Governance:</strong> Reviews administrative privileges, over-permissioned apps, and stale accounts.</li>
                </ul>
                <p className="text-sm bg-blue-500/10 text-blue-600 dark:text-blue-400 p-3 rounded-md border border-blue-500/20">
                  <strong>Note:</strong> Some checks carry higher severity weights. Critical failures can cap your maximum attainable score until resolved.
                </p>
              </AccordionContent>
            </AccordionItem>

            {/* Data Pulling */}
            <AccordionItem value="item-2" className="border rounded-lg px-4 bg-muted/20 data-[state=open]:bg-muted/40 transition-colors">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <div className={cn(badgeVariants({ variant: "outline" }), "w-8 h-8 rounded-full flex items-center justify-center p-0")}>2</div>
                  <span className="font-semibold text-lg">How Data is Pulled</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="text-base text-muted-foreground leading-relaxed pt-2 pb-4 space-y-4">
                <p>
                  This dashboard is a static, offline representation of data collected primarily via the Azure Automation Runbooks (e.g., <code className="text-sm bg-muted px-1.5 py-0.5 rounded">runbookv7.ps1</code>).
                </p>
                <div className="grid gap-3 sm:grid-cols-2 mt-2">
                  <div className="bg-background p-3 rounded-md border">
                    <h4 className="font-semibold text-foreground mb-1">Microsoft Graph API</h4>
                    <p className="text-sm">Used for retrieving users, devices, conditional access policies, and app role assignments via read-only scopes.</p>
                  </div>
                  <div className="bg-background p-3 rounded-md border">
                    <h4 className="font-semibold text-foreground mb-1">Azure Resource Manager</h4>
                    <p className="text-sm">Queries subscription health, Lighthouse delegations, and resource-level role assignments (RBAC).</p>
                  </div>
                </div>
                <p>
                  The script extracts and processes this raw data into JSON files, which this frontend then visualizes. <strong>No sensitive data (like passwords or tokens) is ever exported or stored.</strong>
                </p>
              </AccordionContent>
            </AccordionItem>

            {/* Advice & Recommendations */}
            <AccordionItem value="item-3" className="border rounded-lg px-4 bg-muted/20 data-[state=open]:bg-muted/40 transition-colors">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3">
                  <div className={cn(badgeVariants({ variant: "outline" }), "w-8 h-8 rounded-full flex items-center justify-center p-0")}>3</div>
                  <span className="font-semibold text-lg">Best Practices & Advice</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="text-base text-muted-foreground leading-relaxed pt-2 pb-4 space-y-4">
                <p>
                  To systematically improve your Zero Trust posture, focus on these high-impact areas first:
                </p>
                <div className="space-y-3">
                  <div className="flex gap-3 items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 shrink-0" />
                    <div>
                      <strong className="text-foreground">Enforce Phishing-Resistant MFA</strong>
                      <p className="text-sm mt-0.5">Move away from SMS/Voice based MFA to Authenticator App, FIDO2, or Windows Hello for all critical users.</p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 shrink-0" />
                    <div>
                      <strong className="text-foreground">Block Legacy Authentication</strong>
                      <p className="text-sm mt-0.5">Ensure Conditional Access blocks protocols that don't support modern authentication (like IMAP/POP3).</p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 shrink-0" />
                    <div>
                      <strong className="text-foreground">Require Device Compliance</strong>
                      <p className="text-sm mt-0.5">Only allow access to corporate resources from devices marked as compliant in Intune.</p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={() => setOpen(false)} variant="secondary">
                    Got it, thanks!
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </DialogContent>
    </Dialog>
  );
}
