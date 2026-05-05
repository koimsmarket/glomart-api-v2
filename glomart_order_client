/*
Glomart Order Client V1.0
Cafe24/Glomart 페이지에서 주문 데이터를 Glomart 서버로 저장하기 위한 기본 JS
*/

window.GLOMART_API_BASE = window.GLOMART_API_BASE || "https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app";

window.GlomartOrder = {
  async submit(orderPayload) {
    const res = await fetch(window.GLOMART_API_BASE + "/order", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(orderPayload)
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "ORDER_FAILED");
    return data;
  },

  buildPayloadFromManualInput(input) {
    return {
      source: input.source || "glomart",
      customerName: input.customerName || "",
      phone: input.phone || "",
      email: input.email || "",
      postcode: input.postcode || "",
      address1: input.address1 || "",
      address2: input.address2 || "",
      memo: input.memo || "",

      productName: input.productName || "",
      optionName: input.optionName || "",
      qty: Number(input.qty || 1),
      price: Number(input.price || 0),

      productId: input.productId || "",
      itemId: input.itemId || "",
      vendorItemId: input.vendorItemId || "",
      image: input.image || "",

      cafe24ProductNo: input.cafe24ProductNo || "",
      cafe24VariantCode: input.cafe24VariantCode || ""
    };
  }
};

