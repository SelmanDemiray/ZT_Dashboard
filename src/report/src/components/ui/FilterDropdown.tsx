import { ChevronDown, Check } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FilterDropdownProps {
    value: string;
    onValueChange: (val: string) => void;
    options: { label: string; value: string }[];
    placeholder?: string;
    className?: string;
    icon?: React.ReactNode;
}

export function FilterDropdown({ value, onValueChange, options, placeholder, className, icon }: FilterDropdownProps) {
    const selectedLabel = options.find(o => o.value === value)?.label || placeholder || "Select...";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className={`flex items-center gap-1.5 h-7 rounded-lg border bg-background/80 px-2.5 text-[11px] font-medium transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring ${className || ''}`}>
                {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
                <span className="truncate">{selectedLabel}</span>
                <ChevronDown className="size-3 text-muted-foreground opacity-70 ml-1 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px] max-w-[240px] z-50">
                {options.map((opt) => (
                    <DropdownMenuItem 
                        key={opt.value} 
                        onClick={(e) => { e.stopPropagation(); onValueChange(opt.value); }}
                        className="flex items-center justify-between text-[11px] cursor-pointer"
                    >
                        <span className="truncate">{opt.label}</span>
                        {value === opt.value && <Check className="size-3.5 text-primary ml-2 shrink-0" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
