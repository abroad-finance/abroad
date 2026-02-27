# Changelog: Web Swap UI Redesign (Figma ABROAD - NEW UI by KINTO)

> **Branch:** `new-flow-ui`  
> **Figma reference:** [ABROAD - NEW UI by KINTO](https://www.figma.com/design/IhdYvu6GUat8Wx44pe1qXi/ABROAD---NEW-UI-by-KINTO)  
> **Nodes:** 1-145 (empty state), 4-3 (with value)

---

## Resumen ejecutivo

Rediseño completo del flujo Web Swap para alinear la UI con el diseño de Figma (ABROAD - NEW UI by KINTO). Se actualizaron componentes principales (Swap, HomeScreen, NavBar), se añadieron nuevos componentes reutilizables y se corrigieron errores de integración (Tolgee, controlador).

---

## Cambios por área

### 1. Swap – Rediseño principal

**Archivo:** `abroad-ui/src/features/swap/components/Swap.tsx`

- **Layout tipo card:** Contenedor blanco con `rounded-[32px]`, borde `#f3f4f6` y sombra `0px 10px 40px -10px rgba(0,0,0,0.08)`
- **Header:** Botón atrás (40×40, `#f9fafb`), título "Send Payment", selector de moneda (flags) a la derecha
- **Banner tasa en vivo:** Fondo `#f0fdf4`, indicador verde, texto "Live: {exchangeRateDisplay}"
- **Bloque de monto:** Input grande 48px, fuente black, símbolo de moneda (BRL/COP) adyacente
- **Campo "Send to":** Label, input para Bre-B ID / Chave Pix, sincronizado con estado del controlador
- **Fee y Speed:** Fee (1.5%), Speed (~30s) con icono rayo
- **CTA:** Deshabilitado = "Enter amount" (gris `#e5e7eb`), habilitado = "Send $X" / "Send R$X" (verde `#059669`)
- **Eliminación:** Cards "Pagar desde" y "Recibir en" (la fuente se selecciona en NavBar)
- **Props nuevas:** `recipientValue`, `onRecipientChange` para pre-rellenar datos de destinatario

### 2. HomeScreen – Hero e iconos

**Archivo:** `abroad-ui/src/features/swap/components/HomeScreen.tsx`

- **Iconos:** Emojis reemplazados por lucide (`QrCode`, `Keyboard`), tamaño aumentado
- **Hero:** Padding móvil reducido (`px-4 pt-[10px] pb-8`), trust badges responsivos
- **Transacciones recientes:** Integración con `TransactionListItem[]` de `useWalletDetails` y fallback a `useUserTransactions`

### 3. ChainSelectorModal

**Archivo:** `abroad-ui/src/components/ui/ChainSelectorModal.tsx`

- Iconos USDC y USDT vía `ASSET_URLS.USDC_TOKEN_ICON` y `ASSET_URLS.USDT_TOKEN_ICON`

### 4. NavBar – Logout

**Archivo:** `abroad-ui/src/features/swap/components/NavBarResponsive.tsx`

- Botón de logout con icono `LogOut` a la derecha del botón de wallet
- Llama a `onDisconnectWallet` para desconectar

### 5. WebSwapLayout

**Archivo:** `abroad-ui/src/features/swap/components/WebSwapLayout.tsx`

- `hero-gradient` y `justify-start` para vistas swap y bankDetails
- Título de página oculto en la vista swap
- Ancho máximo `max-w-[576px]` para flujo principal

### 6. Controlador (useWebSwapController)

**Archivo:** `abroad-ui/src/pages/WebSwap/useWebSwapController.ts`

- `recipientValue` y `onRecipientChange` en swapProps: sincroniza pixKey (BRL) o accountNumber (COP)
- `handleBackToSwap`: simplificado a `onBackClick={handleBackToSwap}`

### 7. WebSwap

**Archivo:** `abroad-ui/src/pages/WebSwap/WebSwap.tsx`

- Pasa `onBackClick={handleBackToSwap}` a Swap
- Props de balance y estado de wallet para Swap

### 8. Corrección Tolgee

**Archivo:** `abroad-ui/src/features/swap/components/Swap.tsx`

- Cambio de `'Send {{amount}}'` a `'Send {amount}'` para formato ICU de Tolgee
- Evita `FormatError: Tolgee parser: Unexpected character`

---

## Componentes UI nuevos

| Componente    | Ruta                                      | Descripción                                  |
|--------------|--------------------------------------------|----------------------------------------------|
| AmountInput  | `abroad-ui/src/components/ui/AmountInput.tsx`  | Input de monto con validación                 |
| BottomSheet  | `abroad-ui/src/components/ui/BottomSheet.tsx`  | Sheet inferior móvil                          |
| ChainPill    | `abroad-ui/src/components/ui/ChainPill.tsx`    | Pill de chain/token en NavBar                 |
| CurrencyToggle | `abroad-ui/src/components/ui/CurrencyToggle.tsx` | Toggle COP/BRL con banderas (Figma 9:368)   |
| Overlay      | `abroad-ui/src/components/ui/Overlay.tsx`      | Overlay modal                                 |
| QuickAmounts | `abroad-ui/src/components/ui/QuickAmounts.tsx` | Botones de monto rápido                       |
| StatusBadge  | `abroad-ui/src/components/ui/StatusBadge.tsx`  | Badge de estado de transacción                |

---

## E2E y configuración

- **Playwright:** `abroad-ui/playwright.config.ts`
- **Tests E2E:** `abroad-ui/e2e/` (visual-smoke, console-health, helpers)
- **Design system:** `abroad-ui/abroad-design-system.pen` (referencia de diseño)

---

## Archivos modificados

```
abroad-ui/src/components/ui/ChainSelectorModal.tsx
abroad-ui/src/components/ui/index.ts
abroad-ui/src/features/swap/components/HomeScreen.tsx
abroad-ui/src/features/swap/components/NavBarResponsive.tsx
abroad-ui/src/features/swap/components/Swap.tsx
abroad-ui/src/features/swap/components/WebSwapLayout.tsx
abroad-ui/src/features/swap/types/index.ts
abroad-ui/src/pages/WebSwap/WebSwap.tsx
abroad-ui/src/pages/WebSwap/useWebSwapController.ts
abroad-ui/src/services/useUserTransactions.ts
abroad-ui/src/shared/hooks/useNavBarResponsive.ts
```

---

## Dependencias

- React 19, Vite, Tailwind 4
- Tolgee (i18n), lucide-react (iconos)
- Framer Motion, Lottie

---

## Despliegue

- **Vercel:** El push a `new-flow-ui` en GitHub activa el deploy automático si el proyecto está conectado
- **Build:** `npm run build` en `abroad-ui/`
