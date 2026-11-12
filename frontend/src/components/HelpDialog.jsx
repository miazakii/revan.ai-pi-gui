import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUTS = [
	["Enter", "kirim pesan / pilih command"],
	["Shift + Enter", "baris baru"],
	["Esc", "hentikan run dari mana saja"],
	["⌘/Ctrl + K", "buka command palette"],
	["⌘/Ctrl + F", "cari di transcript"],
	["⌘/Ctrl + B", "buka/tutup sidebar"],
	["⌘/Ctrl + V", "tempel screenshot"],
	["?", "buka bantuan ini"],
];

export default function HelpDialog({ open, onOpenChange }) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Shortcut & Bantuan</DialogTitle>
					<DialogDescription>
						Shortcut keyboard yang tersedia di pi gui.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2">
					{SHORTCUTS.map(([key, label]) => (
						<div
							key={key}
							className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
						>
							<span className="text-muted-foreground">{label}</span>
							<Kbd>{key}</Kbd>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
