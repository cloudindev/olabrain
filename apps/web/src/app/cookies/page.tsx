import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: { absolute: "Política de cookies · OlaBrain" },
  robots: { index: true, follow: true },
};

/** Keep in sync with what the app really sets (Better Auth, next-intl, theme toggle). */
export default function CookiesPage() {
  return (
    <LegalPage title="Política de cookies" updated="22 de octubre de 2026" current="/cookies">
      <h2>Qué son las cookies</h2>
      <p>
        Las cookies son pequeños archivos que un sitio web guarda en tu navegador para recordar
        información entre visitas, como que has iniciado sesión. Esta política explica cuáles usa
        OlaBrain (www.olabrain.com y app.olabrain.com), servicio de Cloudin Hosting S.L.
        («CLOUDIN»).
      </p>

      <h2>Qué cookies usamos</h2>
      <p>
        OlaBrain solo usa <strong>cookies técnicas propias</strong>, necesarias para que el servicio
        funcione. No usamos cookies analíticas, publicitarias ni de terceros. Por eso, conforme al
        artículo 22.2 de la LSSI-CE, no necesitamos pedir tu consentimiento para instalarlas.
      </p>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Finalidad</th>
            <th>Duración</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>better-auth.session_token</code>
            </td>
            <td>Mantener abierta tu sesión en el panel de forma segura.</td>
            <td>7 días, o hasta que cierres sesión</td>
          </tr>
          <tr>
            <td>
              Otras <code>better-auth.*</code>
            </td>
            <td>
              Cookies temporales del proceso de inicio de sesión (por ejemplo, con Google o
              Microsoft) y de verificación de la sesión.
            </td>
            <td>Mientras dura el proceso o la sesión</td>
          </tr>
          <tr>
            <td>
              <code>NEXT_LOCALE</code>
            </td>
            <td>Recordar el idioma que eliges en el panel.</td>
            <td>1 año</td>
          </tr>
        </tbody>
      </table>
      <p>
        En conexiones seguras (HTTPS), estas cookies llevan el prefijo <code>__Secure-</code>.
      </p>

      <h2>Almacenamiento local</h2>
      <p>
        Además, guardamos en el almacenamiento local de tu navegador (<code>localStorage</code>) la
        preferencia de tema claro u oscuro (<code>ba-theme</code>) si la cambias. No sale de tu
        dispositivo y puedes borrarla desde la configuración del navegador.
      </p>

      <h2>Cómo gestionar o eliminar las cookies</h2>
      <p>
        Puedes bloquear o eliminar las cookies desde la configuración de tu navegador. Si bloqueas
        las cookies técnicas no podrás iniciar sesión en el panel. Encontrarás instrucciones en la
        ayuda de{" "}
        <a href="https://support.google.com/chrome/answer/95647" rel="noopener noreferrer">
          Chrome
        </a>
        ,{" "}
        <a href="https://support.apple.com/es-es/105082" rel="noopener noreferrer">
          Safari
        </a>
        ,{" "}
        <a href="https://support.mozilla.org/es/kb/Borrar%20cookies" rel="noopener noreferrer">
          Firefox
        </a>{" "}
        y{" "}
        <a
          href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
          rel="noopener noreferrer"
        >
          Edge
        </a>
        .
      </p>

      <h2>Cambios en esta política</h2>
      <p>
        Si en el futuro usamos cookies analíticas o de marketing, actualizaremos esta política y te
        pediremos el consentimiento antes de instalarlas. Para cualquier duda, escríbenos a{" "}
        <a href="mailto:hola@cloudin.pro">hola@cloudin.pro</a>. Consulta también la{" "}
        <a href="/privacidad">Política de privacidad</a>.
      </p>
    </LegalPage>
  );
}
