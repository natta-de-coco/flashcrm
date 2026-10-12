// A dropdown you can type into. A plain Select is fine for a dozen options and
// unusable for ~190 countries or ~400 timezones: there is no way to jump to
// "Rwanda" except by scrolling.
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { optionSearchScore } from "@/lib/option-search";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  /** Extra words that should find this option: a code, a native name. */
  keywords?: string[];
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  /** Shown on the trigger when nothing is chosen yet. */
  placeholder?: string;
  // The three texts below have no English default on purpose: the caller owns
  // the words, so a picker cannot ship untranslated by leaving a prop out.
  searchPlaceholder: string;
  emptyText: string;
  /** For the trigger, since it is a button and not a labelled input. */
  ariaLabel: string;
};

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected?.label ?? (value || placeholder || ariaLabel)}</span>
          <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command
          // Exact words, not a fuzzy score: see option-search.ts.
          filter={(itemValue, search, keywords) =>
            optionSearchScore([...(keywords ?? []), itemValue], search)
          }
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // Filtering reads value and keywords; the label is what a
                  // person types, so it leads the keywords.
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "me-2 size-4",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
