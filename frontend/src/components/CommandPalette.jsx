import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";

export default function CommandPalette({ open, onOpenChange, items }) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Command palette"
			description="Cari aksi pi gui"
		>
			<CommandInput placeholder="Cari aksi…" />
			<CommandList>
				<CommandEmpty>Tidak ada aksi cocok.</CommandEmpty>
				<CommandGroup heading="Aksi">
					{items.map((item) => {
						const Icon = item.icon;
						return (
							<CommandItem
								key={item.id}
								value={`${item.label} ${item.keywords ?? ""}`}
								onSelect={() => {
									onOpenChange(false);
									item.run();
								}}
							>
								{Icon ? <Icon className="size-4" /> : null}
								<span>{item.label}</span>
								{item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
							</CommandItem>
						);
					})}
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
