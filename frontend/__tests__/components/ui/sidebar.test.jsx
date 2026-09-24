import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";

let mockMobile = false;
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockMobile }));

const State = () => {
  const { state, open, openMobile, setOpen } = useSidebar();
  return <><span>state:{state}:{String(open)}:{String(openMobile)}</span><button onClick={() => setOpen((value) => !value)}>set-open</button></>;
};

const FullSidebar = () => (
  <>
    <Sidebar side="right" variant="floating" collapsible="icon"><SidebarHeader>Header</SidebarHeader><SidebarSeparator /><SidebarContent><SidebarGroup><SidebarGroupLabel>Group</SidebarGroupLabel><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive variant="outline" size="lg" tooltip="Menu">Item</SidebarMenuButton><SidebarMenuAction showOnHover aria-label="Action">A</SidebarMenuAction></SidebarMenuItem></SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter>Footer</SidebarFooter></Sidebar>
    <Sidebar collapsible="none">Always</Sidebar>
    <SidebarInset>Content</SidebarInset>
    <SidebarTrigger aria-label="Primary sidebar toggle" onClick={jest.fn()} />
    <State />
  </>
);

beforeEach(() => { mockMobile = false; });

test("composes desktop sidebar regions and toggles state by controls and shortcut", async () => {
  const user = userEvent.setup();
  render(<SidebarProvider defaultOpen className="custom"><FullSidebar /></SidebarProvider>);
  expect(screen.getByText("state:expanded:true:false")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Item" })).toHaveAttribute("data-active", "true");
  expect(screen.getByText("Always")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Primary sidebar toggle" }));
  expect(screen.getByText("state:collapsed:false:false")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(screen.getByText("state:expanded:true:false")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "set-open" }));
  expect(document.cookie).toContain("sidebar_state=false");
});

test("supports controlled state and asChild menu primitives", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  render(<SidebarProvider open={false} onOpenChange={onOpenChange}><SidebarGroup><SidebarGroupLabel asChild><h2>Heading</h2></SidebarGroupLabel><SidebarMenuButton>Plain menu</SidebarMenuButton><SidebarMenuButton asChild tooltip={{ children: "Tip" }}><a href="/menu">Menu</a></SidebarMenuButton><SidebarMenuAction asChild><a href="/action">Action</a></SidebarMenuAction><SidebarTrigger /></SidebarGroup></SidebarProvider>);
  expect(screen.getByRole("heading", { name: "Heading" })).toHaveAttribute("data-sidebar", "group-label");
  expect(screen.getByRole("link", { name: "Menu" })).toHaveAttribute("data-sidebar", "menu-button");
  expect(screen.getByRole("button", { name: "Plain menu" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
  expect(onOpenChange).toHaveBeenCalledWith(true);
});

test("uses the mobile sheet and mobile toggle state", async () => {
  mockMobile = true;
  const user = userEvent.setup();
  render(<SidebarProvider><SidebarTrigger /><Sidebar side="left"><span>Mobile navigation</span></Sidebar><State /></SidebarProvider>);
  expect(screen.getByText("state:expanded:true:false")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
  expect(screen.getByRole("dialog", { name: "Sidebar navigation" })).toHaveAccessibleDescription("Displays the mobile navigation.");
  expect(screen.getByText("Mobile navigation")).toBeInTheDocument();
  expect(screen.getByText("state:expanded:true:true")).toBeInTheDocument();
});

test("useSidebar rejects consumers outside its provider", () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<State />)).toThrow(/SidebarProvider/);
  consoleError.mockRestore();
});
