import { render, screen } from "@testing-library/react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

test("renders an accessible table composition and preserves caller classes", () => {
  render(
    <Table aria-label="Inquiry queue" className="min-w-3xl">
      <TableHeader>
        <TableRow>
          <TableHead>Inquiry</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>TRP-1</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );

  expect(screen.getByRole("table", { name: "Inquiry queue" })).toHaveClass("min-w-3xl");
  expect(screen.getByRole("columnheader", { name: "Inquiry" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "TRP-1" })).toBeInTheDocument();
});
