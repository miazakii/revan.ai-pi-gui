import { useEffect, useState } from "react";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
	{ value: "light", label: "Terang", icon: SunIcon },
	{ value: "dark", label: "Gelap", icon: MoonIcon },
	{ value: "system", label: "Sistem", icon: MonitorIcon },
];

export default function ThemeMenu() {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	const current = mounted ? theme : "dark";
	const isDark = !mounted || resolvedTheme !== "light";
	const TriggerIcon = current === "system" ? MonitorIcon : isDark ? MoonIcon : SunIcon;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					id="theme-toggle"
					variant="ghost"
					size="sm"
					className="gap-1.5"
					title="Pilih tema"
					aria-label="Pilih tema"
					data-theme={current}
				>
					<TriggerIcon className="size-4" />
					<span className="hidden min-[1440px]:inline">Tema</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuLabel>Tema Tampilan</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{OPTIONS.map((option) => {
					const Icon = option.icon;
					const selected = current === option.value;
					return (
						<DropdownMenuItem
							key={option.value}
							data-theme-option={option.value}
							onSelect={() => setTheme(option.value)}
						>
							<Icon className="size-4" />
							<span>{option.label}</span>
							{selected ? <CheckIcon className="ml-auto size-4" /> : null}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
