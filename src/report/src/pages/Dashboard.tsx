import React from "react";
import { MonitorSmartphone, Users, User, UserCog, Luggage, Monitor, Layers3, Building2, ShieldCheck, CircleCheckBig, Briefcase } from "lucide-react";

import {
    Bar,
    BarChart,
    Cell,
    LabelList,
    Pie,
    PieChart,
    PolarAngleAxis,
    RadialBar,
    RadialBarChart,
    XAxis,
    YAxis,
} from "recharts"

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
// import { Separator } from "@/components/ui/separator"
import { useGlobalFilters } from "@/contexts/GlobalFilterContext";
import { CaSankey } from "@/components/overview/ca-sankey";
import { CaDeviceSankey } from "@/components/overview/caDevice-sankey";
import { AuthMethodSankey } from "@/components/overview/authMethod-sankey";
import { DesktopDevicesSankey } from "@/components/overview/desktop-devices-sankey";
import { MobileSankey } from "@/components/overview/mobile-sankey";
import { Separator } from "@/components/ui/separator";
import { formatNumber, metricDescriptions } from "@/lib/format-utils";
import { OverviewCards } from "@/components/overview-cards";

export default function Dashboard() {
    const { reportData } = useGlobalFilters();

    const tenantMetrics = React.useMemo(() => [
        { label: 'Users', value: reportData.TenantInfo?.TenantOverview?.UserCount, icon: User, color: '#3b82f6', bg: 'from-blue-500/15 to-blue-500/5', ring: '#3b82f625', desc: metricDescriptions.users },
        { label: 'Guests', value: reportData.TenantInfo?.TenantOverview?.GuestCount, icon: Luggage, color: '#8b5cf6', bg: 'from-violet-500/15 to-violet-500/5', ring: '#8b5cf625', desc: metricDescriptions.guests },
        { label: 'Groups', value: reportData.TenantInfo?.TenantOverview?.GroupCount, icon: Users, color: '#a855f7', bg: 'from-purple-500/15 to-purple-500/5', ring: '#a855f725', desc: metricDescriptions.groups },
        { label: 'Apps', value: reportData.TenantInfo?.TenantOverview?.ApplicationCount, icon: Layers3, color: '#ec4899', bg: 'from-pink-500/15 to-pink-500/5', ring: '#ec489925', desc: metricDescriptions.apps },
        { label: 'Devices', value: reportData.TenantInfo?.TenantOverview?.DeviceCount, icon: MonitorSmartphone, color: '#f97316', bg: 'from-orange-500/15 to-orange-500/5', ring: '#f9731625', desc: metricDescriptions.devices },
        { label: 'Managed', value: reportData.TenantInfo?.TenantOverview?.ManagedDeviceCount, icon: Monitor, color: '#22c55e', bg: 'from-emerald-500/15 to-emerald-500/5', ring: '#22c55e25', desc: metricDescriptions.managed },
    ], [reportData.TenantInfo?.TenantOverview]);

    const tenantDetails = React.useMemo(() => [
        { label: 'Name', value: reportData.TenantName || 'Not Available', mono: false },
        { label: 'Tenant ID', value: reportData.TenantId || 'Not Available', mono: true },
        { label: 'Primary Domain', value: reportData.Domain || 'Not Available', mono: false },
    ], [reportData.TenantName, reportData.TenantId, reportData.Domain]);

    return (
        <TooltipProvider delayDuration={200}>
            {/* ── Hero: Tenant / Metrics / Assessment ── */}
            <div className="w-full flex max-w-7xl flex-col gap-6 mt-12">
                <div className="grid w-full gap-5 lg:grid-cols-3">

                    {/* ── Tenant Info Card ── */}
                    <div className="glass-card gradient-border scan-line p-6 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 ring-1 ring-blue-500/20">
                                <Building2 className="size-5 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tenant</p>
                                <h2 className="text-lg font-bold leading-tight">{reportData.TenantName || 'Your Tenant'}</h2>
                            </div>
                        </div>
                        <div className="space-y-3">
                            {tenantDetails.map(({ label, value, mono }) => (
                                <div key={label} className="flex items-start gap-3">
                                    <div className="w-28 shrink-0">
                                        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
                                    </div>
                                    <div className={`flex-1 min-w-0 text-sm font-semibold truncate ${mono ? 'font-mono text-xs text-muted-foreground' : ''}`}>
                                        {value}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Tenant Metrics Grid ── */}
                    <div className="grid gap-3 grid-cols-2 grid-rows-3">
                        {tenantMetrics.map(({ label, value, icon: Icon, color, bg, ring, desc }) => (
                            <Tooltip key={label}>
                                <TooltipTrigger asChild>
                                    <div tabIndex={0} aria-label={`${label}: ${value}`} className={`glass-card flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-br ${bg} border border-border/60 hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-all duration-200 cursor-default`}
                                        style={{ outline: `1px solid ${ring}` }}>
                                        <div className="p-1.5 rounded-lg shrink-0" style={{ background: `${color}18` }}>
                                            <Icon className="size-4" style={{ color }} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
                                            <p className="text-lg font-bold tabular-nums leading-none stat-glow" style={{ color }}>
                                                {formatNumber(value)}
                                            </p>
                                        </div>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs max-w-[180px]">
                                    <p className="font-semibold">{value?.toLocaleString() ?? '0'} {label}</p>
                                    <p className="text-muted-foreground mt-0.5">{desc}</p>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>

                    {/* ── Assessment Results Card ── */}
                    <div className="glass-card gradient-border scan-line p-6 flex flex-col gap-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 ring-1 ring-emerald-500/20">
                                <ShieldCheck className="size-5 text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assessment</p>
                                <h2 className="text-lg font-bold leading-tight">Security Tests</h2>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Radial Chart */}
                            <div className="relative shrink-0 w-28 h-28">
                                <ChartContainer
                                    config={{
                                        move: { label: 'Identity', color: 'hsl(var(--chart-1))' },
                                        exercise: { label: 'Devices', color: 'hsl(var(--chart-2))' },
                                        stand: { label: 'Data', color: 'hsl(var(--chart-3))' },
                                        network: { label: 'Network', color: 'hsl(var(--chart-4))' },
                                    }}
                                    className="w-full h-full"
                                >
                                    <RadialBarChart
                                        margin={{ left: -10, right: -10, top: -10, bottom: -10 }}
                                        data={[
                                            ...(reportData.TestResultSummary.NetworkPassed !== undefined && reportData.TestResultSummary.NetworkTotal !== undefined
                                                ? [{ activity: 'network', value: (reportData.TestResultSummary.NetworkPassed / reportData.TestResultSummary.NetworkTotal) * 100, fill: 'var(--color-network)' }]
                                                : []),
                                            ...(reportData.TestResultSummary.DataPassed !== undefined && reportData.TestResultSummary.DataTotal !== undefined
                                                ? [{ activity: 'data', value: (reportData.TestResultSummary.DataPassed / reportData.TestResultSummary.DataTotal) * 100, fill: 'var(--color-stand)' }]
                                                : []),
                                            { activity: 'devices', value: (reportData.TestResultSummary.DevicesPassed / reportData.TestResultSummary.DevicesTotal) * 100, fill: 'var(--color-exercise)' },
                                            { activity: 'identity', value: (reportData.TestResultSummary.IdentityPassed / reportData.TestResultSummary.IdentityTotal) * 100, fill: 'var(--color-move)' },
                                        ]}
                                        innerRadius="20%" barSize={20} startAngle={90} endAngle={450}
                                    >
                                        <PolarAngleAxis type="number" domain={[0, 100]} dataKey="value" tick={false} />
                                        <RadialBar dataKey="value" background cornerRadius={4} />
                                    </RadialBarChart>
                                </ChartContainer>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <CircleCheckBig className="size-7 text-emerald-500 opacity-80" />
                                </div>
                            </div>

                            {/* Pillar breakdown */}
                            <div className="flex-1 space-y-2.5">
                                {[
                                    { label: 'Identity', passed: reportData.TestResultSummary.IdentityPassed, total: reportData.TestResultSummary.IdentityTotal, color: 'hsl(var(--chart-1))' },
                                    { label: 'Devices', passed: reportData.TestResultSummary.DevicesPassed, total: reportData.TestResultSummary.DevicesTotal, color: 'hsl(var(--chart-2))' },
                                    ...(reportData.TestResultSummary.DataPassed !== undefined ? [{ label: 'Data', passed: reportData.TestResultSummary.DataPassed, total: reportData.TestResultSummary.DataTotal, color: 'hsl(var(--chart-3))' }] : []),
                                    ...(reportData.TestResultSummary.NetworkPassed !== undefined ? [{ label: 'Network', passed: reportData.TestResultSummary.NetworkPassed, total: reportData.TestResultSummary.NetworkTotal, color: 'hsl(var(--chart-4))' }] : []),
                                ].map(({ label, passed, total, color }) => {
                                    const t = total ?? 0;
                                    const p = passed ?? 0;
                                    const pct = t > 0 ? Math.round((p / t) * 100) : 0;
                                    return (
                                        <div key={label} className="space-y-1">
                                            <div className="flex justify-between text-xs">
                                                <span className="text-muted-foreground font-medium">{label}</span>
                                                <span className="font-bold tabular-nums" style={{ color }}>
                                                    {p}/{t}
                                                </span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{ width: `${pct}%`, background: color }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Security Posture Overview Cards ── */}
            <OverviewCards />

            {/* Identity summary */}
            <div className="mx-auto flex max-w-7xl flex-col gap-6 mt-6">
                <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">

                    <div className="grid w-full gap-6 lg:col-span-1">
                        {reportData.TenantInfo?.OverviewAuthMethodsAllUsers?.nodes ? (
                            <Card
                                className="w-full" x-chunk="charts-01-chunk-0"
                            >
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <UserCog className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums">
                                        Privileged users auth methods
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[250px] w-full">
                                        {reportData.TenantInfo?.OverviewAuthMethodsPrivilegedUsers?.nodes ? (
                                            <AuthMethodSankey data={reportData.TenantInfo.OverviewAuthMethodsPrivilegedUsers.nodes} />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                                No data available
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter className="flex-col items-start gap-1">
                                    <CardDescription>
                                        {reportData.TenantInfo?.OverviewAuthMethodsPrivilegedUsers?.description || "No description available"}
                                    </CardDescription>
                                </CardFooter>
                            </Card>
                        ) : null}

                        {reportData.TenantInfo?.OverviewAuthMethodsAllUsers?.nodes ? (
                            <Card
                                className="w-full" x-chunk="charts-01-chunk-0"
                            >
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <Users className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums">
                                        All users auth methods
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[250px] w-full">
                                        {reportData.TenantInfo?.OverviewAuthMethodsAllUsers?.nodes ? (
                                            <AuthMethodSankey data={reportData.TenantInfo.OverviewAuthMethodsAllUsers.nodes} />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                                No data available
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter className="flex-col items-start gap-1">
                                    <CardDescription>
                                        {reportData.TenantInfo?.OverviewAuthMethodsAllUsers?.description || "No description available"}
                                    </CardDescription>
                                </CardFooter>
                            </Card>
                        ) : null}
                    </div>
                    <div className="grid w-full gap-6 lg:col-span-1">
                        {reportData.TenantInfo?.OverviewAuthMethodsAllUsers?.nodes ? (
                            <Card
                                className="w-full" x-chunk="charts-01-chunk-0"
                            >
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <User className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums">
                                        User authentication
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[250px] w-full">
                                        {reportData.TenantInfo?.OverviewCaMfaAllUsers?.nodes ? (
                                            <CaSankey data={reportData.TenantInfo.OverviewCaMfaAllUsers.nodes} />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                                No data available
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter className="flex-col items-start gap-1">
                                    <CardDescription>
                                        {reportData.TenantInfo?.OverviewCaMfaAllUsers?.description || "No description available"}
                                    </CardDescription>
                                </CardFooter>
                            </Card>
                        ) : null}

                        {reportData.TenantInfo?.OverviewAuthMethodsPrivilegedUsers?.nodes ? (
                            <Card
                                className="w-full" x-chunk="charts-01-chunk-0"
                            >
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <MonitorSmartphone className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums ">
                                        Device sign-ins
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[250px] w-full">
                                        {reportData.TenantInfo?.OverviewCaDevicesAllUsers?.nodes ? (
                                            <CaDeviceSankey data={reportData.TenantInfo.OverviewCaDevicesAllUsers.nodes} />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                                No data available
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter className="flex-col items-start gap-1">
                                    <CardDescription>
                                        {reportData.TenantInfo?.OverviewCaDevicesAllUsers?.description || "No description available"}
                                    </CardDescription>
                                </CardFooter>
                            </Card>
                        ) : null}
                    </div>
                </div>
            </div >

            {/* Devices Section */}
            <div className="flex max-w-7xl flex-col gap-6 mt-6">
                <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
                    {/* Device summary chart */}
                    {
                        reportData.TenantInfo?.DeviceOverview?.ManagedDevices ? (
                            <Card className="w-full">
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <MonitorSmartphone className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums">Device summary</CardTitle>
                                </CardHeader>
                                <CardContent className="flex pb-4 h-[250px]">
                                    <ChartContainer
                                        config={{
                                            value: {
                                                label: "Devices",
                                            },
                                        }}
                                        className="h-[250px] w-full"
                                    >
                                        <BarChart
                                            margin={{
                                                left: 12,
                                                right: 0,
                                                top: 0,
                                                bottom: 10,
                                            }}
                                            data={[
                                                {
                                                    dataKey: "Windows",
                                                    value: reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes?.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0,
                                                    label: `${reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes?.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0}`,
                                                    fill: "hsl(var(--chart-1))",
                                                },
                                                {
                                                    dataKey: "macOS",
                                                    value: reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes?.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0,
                                                    label: `${reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes?.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0}`,
                                                    fill: "hsl(var(--chart-2))",
                                                },
                                                {
                                                    dataKey: "iOS",
                                                    value: reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes?.find(n => n.source === "Mobile devices" && n.target === "iOS")?.value || 0,
                                                    label: `${reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes?.find(n => n.source === "Mobile devices" && n.target === "iOS")?.value || 0}`,
                                                    fill: "hsl(var(--chart-3))",
                                                },
                                                {
                                                    dataKey: "Android",
                                                    value: reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes?.find(n => n.source === "Mobile devices" && n.target === "Android")?.value || 0,
                                                    label: `${reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes?.find(n => n.source === "Mobile devices" && n.target === "Android")?.value || 0}`,
                                                    fill: "hsl(var(--chart-5))",
                                                },
                                                {
                                                    dataKey: "Linux",
                                                    value: reportData.TenantInfo?.DeviceOverview?.ManagedDevices?.deviceOperatingSystemSummary?.linuxCount || 0,
                                                    label: `${reportData.TenantInfo?.DeviceOverview?.ManagedDevices?.deviceOperatingSystemSummary?.linuxCount || 0}`,
                                                    fill: "hsl(var(--chart-4))",
                                                },
                                            ]}
                                            layout="vertical"
                                            barSize={32}
                                            barGap={2}
                                        >
                                            <XAxis type="number" dataKey="value" hide />
                                            <YAxis
                                                dataKey="dataKey"
                                                type="category"
                                                tickLine={false}
                                                tickMargin={4}
                                                axisLine={false}
                                                className=""
                                            />
                                            <ChartTooltip
                                                cursor={false}
                                                content={<ChartTooltipContent />}
                                            />
                                            <Bar dataKey="value" radius={5}>
                                                <LabelList
                                                    position="insideLeft"
                                                    dataKey="label"
                                                    fill="white"
                                                    offset={8}
                                                    fontSize={12}
                                                />
                                            </Bar>
                                        </BarChart>
                                    </ChartContainer>
                                </CardContent>
                                <CardFooter className="flex flex-row border-t p-4">
                                    <div className="flex w-full items-center gap-2">
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Desktops</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const desktopNodes = reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes || [];
                                                    const mobileNodes = reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes || [];
                                                    
                                                    const winCount = desktopNodes.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0;
                                                    const macCount = desktopNodes.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0;
                                                    const iosCount = mobileNodes.find(n => n.source === "Mobile devices" && n.target === "iOS")?.value || 0;
                                                    const andCount = mobileNodes.find(n => n.source === "Mobile devices" && n.target === "Android")?.value || 0;
                                                    const linCount = reportData.TenantInfo?.DeviceOverview?.ManagedDevices?.deviceOperatingSystemSummary?.linuxCount || 0;
                                                    
                                                    const totalD = winCount + macCount;
                                                    const totalM = iosCount + andCount;
                                                    const total = totalD + totalM + linCount;
                                                    
                                                    return total > 0 ? Math.round((totalD / total) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Mobiles</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const desktopNodes = reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes || [];
                                                    const mobileNodes = reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes || [];
                                                    
                                                    const winCount = desktopNodes.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0;
                                                    const macCount = desktopNodes.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0;
                                                    const iosCount = mobileNodes.find(n => n.source === "Mobile devices" && n.target === "iOS")?.value || 0;
                                                    const andCount = mobileNodes.find(n => n.source === "Mobile devices" && n.target === "Android")?.value || 0;
                                                    const linCount = reportData.TenantInfo?.DeviceOverview?.ManagedDevices?.deviceOperatingSystemSummary?.linuxCount || 0;
                                                    
                                                    const totalD = winCount + macCount;
                                                    const totalM = iosCount + andCount;
                                                    const total = totalD + totalM + linCount;
                                                    
                                                    return total > 0 ? Math.round((totalM / total) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </CardFooter>
                            </Card>
                        ) : null
                    }

                    {/* Device compliance chart */}
                    {
                        (reportData.TenantInfo?.DeviceOverview?.ManagedDevices?.totalCount || 0) > 0 &&
                        (reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.compliantDeviceCount || 0) +
                        (reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.nonCompliantDeviceCount || 0) > 0 && (
                            <Card className="w-full">
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <CircleCheckBig className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums ">
                                        Device compliance
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex pb-2 h-[250px]">
                                    <ChartContainer
                                        config={{
                                            compliant: {
                                                label: "Compliant",
                                                color: "hsl(142, 76%, 36%)",
                                            },
                                            nonCompliant: {
                                                label: "Non-compliant",
                                                color: "hsl(0, 84%, 60%)",
                                            },
                                        }}
                                        className="mx-auto aspect-square w-full max-h-full"
                                    >
                                        <PieChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                                            <Pie
                                                data={[
                                                    {
                                                        name: "Compliant",
                                                        value: reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.compliantDeviceCount || 0,
                                                        fill: "var(--color-compliant)",
                                                    },
                                                    {
                                                        name: "Non-compliant",
                                                        value: reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.nonCompliantDeviceCount || 0,
                                                        fill: "var(--color-nonCompliant)",
                                                    },
                                                ]}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={50}
                                                outerRadius={100}
                                                paddingAngle={2}
                                                dataKey="value"
                                                cornerRadius={5}
                                            >
                                                <Cell fill="var(--color-compliant)" />
                                                <Cell fill="var(--color-nonCompliant)" />
                                            </Pie>
                                            <ChartTooltip content={<ChartTooltipContent />} />
                                        </PieChart>
                                    </ChartContainer>
                                </CardContent>
                                <CardFooter className="flex flex-row border-t p-4">
                                    <div className="flex w-full items-center gap-2">
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <div className="w-3 h-3 rounded-sm bg-green-600"></div>
                                                Compliant
                                            </div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const compliant = reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.compliantDeviceCount || 0;
                                                    const nonCompliant = reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.nonCompliantDeviceCount || 0;
                                                    const total = compliant + nonCompliant;
                                                    return total > 0 ? Math.round((compliant / total) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <div className="w-3 h-3 rounded-sm bg-red-500"></div>
                                                Non-compliant
                                            </div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const compliant = reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.compliantDeviceCount || 0;
                                                    const nonCompliant = reportData.TenantInfo?.DeviceOverview?.DeviceCompliance?.nonCompliantDeviceCount || 0;
                                                    const total = compliant + nonCompliant;
                                                    return total > 0 ? Math.round((nonCompliant / total) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </CardFooter>
                            </Card>
                        )
                    }

                    {/* Corporate vs Personal chart */}
                    {
                        (reportData.TenantInfo?.DeviceOverview?.ManagedDevices?.totalCount || 0) > 0 &&
                        (reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.corporateCount || 0) +
                        (reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.personalCount || 0) > 0 && (
                            <Card className="w-full">
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <Briefcase className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums ">
                                        Device ownership
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex pb-2 h-[250px]">
                                    <ChartContainer
                                        config={{
                                            corporate: {
                                                label: "Corporate",
                                                color: "hsl(217, 91%, 60%)",
                                            },
                                            personal: {
                                                label: "Personal",
                                                color: "hsl(280, 85%, 60%)",
                                            },
                                        }}
                                        className="mx-auto aspect-square w-full max-h-full"
                                    >
                                        <PieChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                                            <Pie
                                                data={[
                                                    {
                                                        name: "Corporate",
                                                        value: reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.corporateCount || 0,
                                                        fill: "var(--color-corporate)",
                                                    },
                                                    {
                                                        name: "Personal",
                                                        value: reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.personalCount || 0,
                                                        fill: "var(--color-personal)",
                                                    },
                                                ]}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={50}
                                                outerRadius={100}
                                                paddingAngle={2}
                                                dataKey="value"
                                                cornerRadius={5}
                                            >
                                                <Cell fill="var(--color-corporate)" />
                                                <Cell fill="var(--color-personal)" />
                                            </Pie>
                                            <ChartTooltip content={<ChartTooltipContent />} />
                                        </PieChart>
                                    </ChartContainer>
                                </CardContent>
                                <CardFooter className="flex flex-row border-t p-4">
                                    <div className="flex w-full items-center gap-2">
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <div className="w-3 h-3 rounded-sm bg-blue-500"></div>
                                                Corporate
                                            </div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const corporate = reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.corporateCount || 0;
                                                    const personal = reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.personalCount || 0;
                                                    const total = corporate + personal;
                                                    return total > 0 ? Math.round((corporate / total) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <div className="w-3 h-3 rounded-sm bg-purple-500"></div>
                                                Personal
                                            </div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const corporate = reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.corporateCount || 0;
                                                    const personal = reportData.TenantInfo?.DeviceOverview?.DeviceOwnership?.personalCount || 0;
                                                    const total = corporate + personal;
                                                    return total > 0 ? Math.round((personal / total) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </CardFooter>
                            </Card>
                        )
                    }

                    {/* Desktop devices chart */}
                    {
                        reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes && reportData.TenantInfo.DeviceOverview.DesktopDevicesSummary.nodes.length > 0 && (
                            <Card className="w-full lg:col-span-3">
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <Monitor className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums">
                                        Desktop devices
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ChartContainer
                                        config={{
                                            steps: {
                                                label: "Steps",
                                                color: "hsl(var(--chart-1))",
                                            },
                                        }}
                                        className="h-[350px] w-full"
                                    >
                                        {reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes ? (
                                            <DesktopDevicesSankey data={reportData.TenantInfo.DeviceOverview.DesktopDevicesSummary.nodes} />
                                        ) : (
                                            <div className="flex items-center justify-center h-32 text-muted-foreground">
                                                No data available
                                            </div>
                                        )}
                                    </ChartContainer>
                                </CardContent>
                                <CardFooter className="flex flex-row border-t p-4">
                                    <div className="flex w-full items-center gap-2">
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Entra joined</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const nodes = reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes || [];
                                                    const entraJoined = nodes.find(n => n.target === "Entra joined")?.value || 0;
                                                    const windowsDevices = nodes.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0;
                                                    const macOSDevices = nodes.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0;
                                                    const total = windowsDevices + macOSDevices;
                                                    return Math.round((entraJoined / (total || 1)) * 100);
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Entra hybrid joined</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const nodes = reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes || [];
                                                    const entraHybrid = nodes.find(n => n.target === "Entra hybrid joined")?.value || 0;
                                                    const windowsDevices = nodes.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0;
                                                    const macOSDevices = nodes.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0;
                                                    const total = windowsDevices + macOSDevices;
                                                    return Math.round((entraHybrid / (total || 1)) * 100);
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Entra registered</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const nodes = reportData.TenantInfo?.DeviceOverview?.DesktopDevicesSummary?.nodes || [];
                                                    const entraRegistered = nodes.find(n => n.target === "Entra registered")?.value || 0;
                                                    const windowsDevices = nodes.find(n => n.source === "Desktop devices" && n.target === "Windows")?.value || 0;
                                                    const macOSDevices = nodes.find(n => n.source === "Desktop devices" && n.target === "macOS")?.value || 0;
                                                    const total = windowsDevices + macOSDevices;
                                                    return Math.round((entraRegistered / (total || 1)) * 100);
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </CardFooter>
                            </Card>
                        )
                    }

                    {/* Mobile devices chart */}
                    {
                        reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes && reportData.TenantInfo?.DeviceOverview?.ManagedDevices && (
                            <Card className="w-full lg:col-span-3">
                                <CardHeader className="space-y-0 pb-2 flex-row">
                                    <MonitorSmartphone className="pr-2 size-8" />
                                    <CardTitle className="text-2xl tabular-nums">
                                        Mobile devices
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ChartContainer
                                        config={{
                                            steps: {
                                                label: "Steps",
                                                color: "hsl(var(--chart-1))",
                                            },
                                        }}
                                        className="h-[350px] w-full"
                                    >
                                        {reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes ? (
                                            <MobileSankey data={reportData.TenantInfo.DeviceOverview.MobileSummary.nodes} />
                                        ) : (
                                            <div className="flex items-center justify-center h-32 text-muted-foreground">
                                                No data available
                                            </div>
                                        )}
                                    </ChartContainer>
                                </CardContent>
                                <CardFooter className="flex flex-row border-t p-4">
                                    <div className="flex w-full items-center gap-2">
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Android compliant</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const nodes = reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes || [];
                                                    const androidCompliant = nodes.filter(n => n.source?.includes("Android") && n.target === "Compliant").reduce((sum, n) => sum + (n.value || 0), 0);
                                                    const androidTotal = nodes.find(n => n.source === "Mobile devices" && n.target === "Android")?.value || 0;
                                                    return androidTotal > 0 ? Math.round((androidCompliant / androidTotal) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">iOS compliant</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const nodes = reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes || [];
                                                    const iosCompliant = nodes.filter(n => n.source?.includes("iOS") && n.target === "Compliant").reduce((sum, n) => sum + (n.value || 0), 0);
                                                    const iosTotal = nodes.find(n => n.source === "Mobile devices" && n.target === "iOS")?.value || 0;
                                                    return iosTotal > 0 ? Math.round((iosCompliant / iosTotal) * 100) : 0;
                                                })()}
                                                <span className="text-sm font-normal text-muted-foreground">
                                                    %
                                                </span>
                                            </div>
                                        </div>
                                        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
                                        <div className="grid flex-1 auto-rows-min gap-0.5">
                                            <div className="text-xs text-muted-foreground">Total devices</div>
                                            <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
                                                {(() => {
                                                    const nodes = reportData.TenantInfo?.DeviceOverview?.MobileSummary?.nodes || [];
                                                    const androidTotal = nodes.find(n => n.source === "Mobile devices" && n.target === "Android")?.value || 0;
                                                    const iosTotal = nodes.find(n => n.source === "Mobile devices" && n.target === "iOS")?.value || 0;
                                                    return androidTotal + iosTotal;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </CardFooter>
                            </Card>
                        )
                    }

                </div >
            </div >
        </TooltipProvider>
    );
}
