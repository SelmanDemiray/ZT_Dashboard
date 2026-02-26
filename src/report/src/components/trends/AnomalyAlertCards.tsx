import { useState, useMemo, useCallback } from 'react';
import { Bell, X, AlertTriangle, TrendingDown, Eye, EyeOff } from 'lucide-react';
import { dismissAlert, getDismissedAlerts } from '@/lib/trends-utils';
import type { AnomalyAlert } from '@/types/assessment';

interface Props {
    alerts: AnomalyAlert[];
}

export function AnomalyAlertCards({ alerts }: Props) {
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getDismissedAlerts());
    const [showDismissed, setShowDismissed] = useState(false);

    const handleDismiss = useCallback((alertId: string) => {
        dismissAlert(alertId);
        setDismissedIds(prev => new Set(prev).add(alertId));
    }, []);

    const activeAlerts = useMemo(
        () => alerts.filter(a => !dismissedIds.has(a.id)),
        [alerts, dismissedIds],
    );
    const dismissedAlerts = useMemo(
        () => alerts.filter(a => dismissedIds.has(a.id)),
        [alerts, dismissedIds],
    );

    if (alerts.length === 0) {
        return (
            <div className="glass-card gradient-border p-6 text-center text-sm text-muted-foreground">
                <Bell size={20} className="mx-auto mb-2 opacity-40" />
                No anomalies or regressions detected in the current window.
            </div>
        );
    }

    return (
        <div className="glass-card gradient-border scan-line overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-border/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Bell size={18} className="text-amber-400" />
                        <h3 className="text-sm font-semibold tracking-tight">Anomaly &amp; Regression Alerts</h3>
                        {activeAlerts.length > 0 && (
                            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/20">
                                {activeAlerts.length}
                            </span>
                        )}
                    </div>
                    {dismissedAlerts.length > 0 && (
                        <button
                            onClick={() => setShowDismissed(!showDismissed)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showDismissed ? <EyeOff size={10} /> : <Eye size={10} />}
                            {showDismissed ? 'Hide' : 'Show'} {dismissedAlerts.length} dismissed
                        </button>
                    )}
                </div>
            </div>

            <div className="p-4 sm:p-5 space-y-2 max-h-[350px] overflow-y-auto">
                {activeAlerts.length === 0 && !showDismissed && (
                    <p className="text-center text-xs text-muted-foreground py-3">All alerts have been dismissed.</p>
                )}
                {activeAlerts.map(alert => (
                    <AlertItem key={alert.id} alert={alert} onDismiss={handleDismiss} isDismissed={false} />
                ))}
                {showDismissed && dismissedAlerts.map(alert => (
                    <AlertItem key={alert.id} alert={alert} onDismiss={handleDismiss} isDismissed={true} />
                ))}
            </div>
        </div>
    );
}

function AlertItem({ alert, onDismiss, isDismissed }: {
    alert: AnomalyAlert;
    onDismiss: (id: string) => void;
    isDismissed: boolean;
}) {
    const isRegression = alert.currentValue < alert.previousValue;
    const changePct = alert.previousValue !== 0
        ? Math.round(((alert.currentValue - alert.previousValue) / alert.previousValue) * 100)
        : 0;

    return (
        <div
            className={`rounded-lg border p-3 transition-all ${isDismissed
                    ? 'opacity-50 border-border/30 bg-muted/10'
                    : 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                }`}
        >
            <div className="flex items-start gap-2">
                {isRegression
                    ? <TrendingDown size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                    : <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium">{alert.description}</p>
                        {!isDismissed && (
                            <button
                                onClick={() => onDismiss(alert.id)}
                                className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                                title="Dismiss alert"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{alert.rootCause}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px]">
                        <span className="text-muted-foreground">
                            <span className="font-medium text-foreground">{alert.sourceMetric}</span>
                        </span>
                        <span className="text-muted-foreground">
                            {alert.previousValue} → {alert.currentValue}
                            <span
                                className="ml-1 font-medium"
                                style={{ color: isRegression ? '#ef4444' : '#22c55e' }}
                            >
                                ({changePct > 0 ? '+' : ''}{changePct}%)
                            </span>
                        </span>
                        <span className="text-muted-foreground/60">{alert.runDate}</span>
                    </div>
                    {alert.recommendation && (
                        <p className="text-[10px] text-sky-400/80 mt-1.5">
                            💡 {alert.recommendation}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
