export function createFileRoute(_path: string) {
  return (_options: unknown) => ({ useSearch: () => ({}) });
}
