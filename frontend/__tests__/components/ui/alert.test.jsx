import { render, screen } from "@testing-library/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
test("renders an accessible alert structure", () => { render(<Alert><AlertTitle>Warning</AlertTitle><AlertDescription>Details</AlertDescription></Alert>); expect(screen.getByRole("alert")).toHaveTextContent("WarningDetails"); });
