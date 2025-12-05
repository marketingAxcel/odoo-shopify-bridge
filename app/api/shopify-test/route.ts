import { NextRequest } from "next/server";
import { getSomeProducts } from "@/lib/shopifyClient";

export async function GET(_req: NextRequest) {
  try {
    const products = await getSomeProducts(3);

    return new Response(
      JSON.stringify({
        ok: true,
        count: products.length,
        products,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error Shopify test:", err);
    return new Response(
      JSON.stringify({
        error: err?.message || "Error interno",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
