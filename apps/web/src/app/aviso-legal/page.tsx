import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: { absolute: "Aviso legal · OlaBrain" },
  robots: { index: true, follow: true },
};

export default function LegalNoticePage() {
  return (
    <LegalPage title="Aviso legal" updated="22 de octubre de 2026" current="/aviso-legal">
      <h2>Titular del sitio web</h2>
      <p>
        En cumplimiento del artículo 10 de la Ley 34/2002, de 11 de julio, de Servicios de la
        Sociedad de la Información y de Comercio Electrónico (LSSI-CE), te informamos de que los
        sitios web www.olabrain.com, olabrain.com y app.olabrain.com («OlaBrain») son titularidad
        de:
      </p>
      <ul>
        <li>
          <strong>Denominación social:</strong> Cloudin Hosting S.L. («CLOUDIN»)
        </li>
        <li>
          <strong>NIF:</strong> B56282924
        </li>
        <li>
          <strong>Domicilio social:</strong> C/ La Lila, 5 – 1º, 33002 Oviedo, Principado de
          Asturias, España
        </li>
        <li>
          <strong>Datos registrales:</strong> Registro Mercantil de Asturias, Tomo 4769, Libro 0,
          Folio 225, Hoja AS34722
        </li>
        <li>
          <strong>Correo electrónico:</strong>{" "}
          <a href="mailto:hola@cloudin.pro">hola@cloudin.pro</a>
        </li>
      </ul>

      <h2>Objeto</h2>
      <p>
        OlaBrain es una plataforma para crear empleados digitales: agentes de inteligencia
        artificial que conversan por voz y por chat y que, con la autorización de su usuario,
        acceden a las aplicaciones y sistemas de su empresa. Este aviso legal regula el acceso y la
        navegación por los sitios web de OlaBrain. La contratación y el uso del servicio se rigen
        además por las condiciones que se acepten al crear una cuenta.
      </p>

      <h2>Condiciones de uso</h2>
      <p>
        El acceso a los sitios web implica la aceptación de este aviso legal. Como usuario te
        comprometes a hacer un uso adecuado de los contenidos y servicios y, en particular, a no
        emplearlos para:
      </p>
      <ul>
        <li>Actividades ilícitas, contrarias a la buena fe o al orden público.</li>
        <li>
          Introducir virus o cualquier otro sistema que pueda dañar los sistemas de CLOUDIN, de sus
          proveedores o de terceros.
        </li>
        <li>
          Acceder sin autorización a cuentas, datos o sistemas ajenos, o intentar eludir las medidas
          de seguridad del servicio.
        </li>
        <li>
          Suplantar a otras personas o hacer creer que las respuestas de un agente las da una
          persona humana.
        </li>
      </ul>
      <p>
        CLOUDIN podrá suspender el acceso a quien incumpla estas condiciones, sin perjuicio de las
        acciones legales que correspondan.
      </p>

      <h2>Inteligencia artificial</h2>
      <p>
        Los agentes de OlaBrain son sistemas de inteligencia artificial y se presentan como tales a
        las personas con las que interactúan. Sus respuestas se generan automáticamente y pueden
        contener errores, por lo que te recomendamos revisar la información importante antes de
        tomar decisiones basadas en ella. Las acciones que modifican datos en tus sistemas requieren
        tu confirmación, salvo que hayas configurado lo contrario.
      </p>

      <h2>Propiedad intelectual e industrial</h2>
      <p>
        Los contenidos de los sitios web (textos, diseño, logotipos, imágenes, vídeos, software y
        marcas) son titularidad de CLOUDIN o de terceros que han autorizado su uso, y están
        protegidos por la normativa de propiedad intelectual e industrial. No se permite su
        reproducción, distribución, comunicación pública ni transformación sin autorización expresa.
        Los nombres y logotipos de aplicaciones de terceros que aparecen en el sitio pertenecen a
        sus respectivos titulares y se muestran solo para indicar compatibilidad.
      </p>
      <p>
        El contenido que subes a OlaBrain y los resultados que tus agentes generan para ti te
        pertenecen.
      </p>

      <h2>Responsabilidad</h2>
      <p>
        CLOUDIN trabaja para que los sitios web estén disponibles y funcionen correctamente, pero no
        garantiza la ausencia de interrupciones o errores, y no se hace responsable de los daños
        derivados de causas ajenas a su control, del uso indebido de los servicios ni de los
        contenidos de sitios de terceros enlazados.
      </p>

      <h2>Protección de datos y cookies</h2>
      <p>
        El tratamiento de datos personales se describe en la{" "}
        <a href="/privacidad">Política de privacidad</a> y el uso de cookies, en la{" "}
        <a href="/cookies">Política de cookies</a>.
      </p>

      <h2>Legislación aplicable y jurisdicción</h2>
      <p>
        Este aviso legal se rige por la legislación española. Para cualquier controversia, las
        partes se someten a los juzgados y tribunales de Oviedo, salvo que la normativa aplicable
        disponga otro fuero, como ocurre cuando el usuario tiene la condición de consumidor.
      </p>
    </LegalPage>
  );
}
