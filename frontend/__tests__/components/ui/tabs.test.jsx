import { render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "@/components/ui/tabs";
test("renders accessible tab navigation", () => { render(<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger></TabsList><TabsContent value="one">Panel</TabsContent></Tabs>); expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true"); expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel"); });
test("keeps the tabs list style variants public", () => { expect(tabsListVariants({ variant: "line" })).toContain("data-[variant=line]"); });
