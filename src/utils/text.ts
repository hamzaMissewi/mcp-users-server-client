export function parseUserFromFreeformText(text: string): {
  name?: string;
  email?: string;
  address?: string;
  phone?: string;
} | null {
  const get = (label: string) => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "i");
    const m = text.match(re);
    return m?.[1]?.trim();
  };

  // Handle common labels
  let name = get("Name");
  let email = get("Email");
  let address = get("Address");
  let phone = get("Phone Number") ?? get("Phone");

  // Clean common parentheses notes after values
  const stripNotes = (v?: string) => v?.replace(/\s*\([^)]*\)\s*$/g, "").trim();

  name = stripNotes(name);
  email = stripNotes(email);
  address = stripNotes(address);
  phone = stripNotes(phone);

  if (!name || !email) return null;

  return { name, email, address, phone };
}

export function parseUserFromFreeformText2(
  text: string
): { name: string; email: string; address?: string; phone?: string } | null {
  try {
    // Strip code fences if present
    const cleaned = text
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/, "")
      .trim();

    const obj = JSON.parse(cleaned);

    // Normalize common variants:
    // Name
    let name: string | undefined =
      obj.name ??
      (obj.firstName && obj.lastName
        ? `${obj.firstName} ${obj.lastName}`
        : undefined);

    // Address (string or object)
    let address: string | undefined = obj.address;
    if (address && typeof address === "object") {
      const { street, city, state, zip, zipCode } = address as any;
      const zipStr = zip ?? zipCode;
      address = [street, city, state, zipStr].filter(Boolean).join(", ");
    }

    // Phone
    let phone: string | undefined = obj.phone ?? obj.phoneNumber;

    const email: string | undefined = obj.email;

    // if (!name || !email || !address || !phone) return null;
    if (!name || !email) return null;

    return { name, email, address, phone };
  } catch {
    return null;
  }
}
