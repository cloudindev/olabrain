import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: { absolute: "Política de privacidad · OlaBrain" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidad" updated="22 de octubre de 2026" current="/privacidad">
      <h2>Responsable del tratamiento</h2>
      <p>
        OlaBrain (www.olabrain.com y app.olabrain.com) es un servicio de CLOUDIN. Cuando el titular
        de los datos facilita datos a través de OlaBrain, el Responsable del Tratamiento de esos
        datos es Cloudin Hosting S.L. («CLOUDIN»). Puedes contactar con nosotros en{" "}
        <a href="mailto:hola@cloudin.pro">hola@cloudin.pro</a>.
      </p>
      <p>
        CLOUDIN se compromete a proteger los datos de carácter personal de todas las personas cuyos
        datos trata, a cumplir la normativa de protección de datos aplicable (en particular, el
        Reglamento (UE) 2016/679, RGPD, y la Ley Orgánica 3/2018, LOPDGDD) y a ofrecer las máximas
        garantías de confidencialidad y seguridad.
      </p>

      <h2>Con qué finalidad tratamos datos de carácter personal</h2>
      <ul>
        <li>
          <strong>Prestación del servicio OlaBrain:</strong> creamos y gestionamos tu cuenta
          (nombre, correo electrónico, contraseña cifrada y, en su caso, empresa) y tratamos las
          instrucciones, mensajes de texto o voz, archivos y configuraciones que das a tus agentes
          para que ejecuten las tareas que les pides.
        </li>
        <li>
          <strong>Servicios conectados:</strong> si conectas una cuenta de terceros (por ejemplo,
          Google Drive), tratamos los datos a los que nos des acceso con su autorización, únicamente
          para las funciones que tú solicitas. Consulta el apartado{" "}
          <a href="#datos-de-google">«Datos de Google»</a>.
        </li>
        <li>
          <strong>Consultas y presupuestos:</strong> para responder a las consultas que nos hagas
          sobre nuestros servicios, preparar presupuestos o tramitar la contratación.
        </li>
        <li>
          <strong>Facturación:</strong> para emitir facturas y cumplir nuestras obligaciones
          fiscales y contables. Los datos de tarjeta los gestiona directamente el proveedor de pagos
          y CLOUDIN no los almacena.
        </li>
        <li>
          <strong>Newsletter:</strong> si te suscribes, recibirás nuestras comunicaciones en el
          correo electrónico que indiques hasta que decidas darte de baja.
        </li>
        <li>
          <strong>Seguridad y funcionamiento:</strong> registramos datos técnicos (dirección IP,
          navegador, dispositivo, fechas de acceso y errores) para proteger el servicio y resolver
          incidencias.
        </li>
      </ul>
      <p>
        No tomamos decisiones con efectos jurídicos sobre ti basadas únicamente en tratamientos
        automatizados.
      </p>

      <h2>Justificación legal para el tratamiento de los datos</h2>
      <ul>
        <li>
          <strong>Ejecución del contrato (art. 6.1.b RGPD):</strong> gestión de la cuenta,
          prestación del servicio OlaBrain y uso de los servicios que conectas.
        </li>
        <li>
          <strong>Consentimiento (art. 6.1.a RGPD):</strong> autorización de acceso a servicios de
          terceros como Google Drive y suscripción al newsletter. Puedes retirarlo en cualquier
          momento.
        </li>
        <li>
          <strong>Obligación legal (art. 6.1.c RGPD):</strong> facturación y conservación de
          documentación fiscal y contable.
        </li>
        <li>
          <strong>Interés legítimo (art. 6.1.f RGPD):</strong> responder a las consultas que nos
          planteas y garantizar la seguridad del servicio.
        </li>
      </ul>

      <h2 id="datos-de-google" className="scroll-mt-24">
        Datos de Google (Google Drive)
      </h2>
      <p>
        Si conectas tu cuenta de Google, OlaBrain solicita únicamente el permiso{" "}
        <code>https://www.googleapis.com/auth/drive.file</code>. Con este permiso solo podemos
        acceder a los archivos de Google Drive que tú creas o abres explícitamente con OlaBrain, no
        al resto de tu Drive.
      </p>
      <ul>
        <li>
          <strong>Uso:</strong> crear, leer, actualizar o eliminar esos archivos cuando tú o uno de
          tus agentes lo pedís (por ejemplo, guardar un informe generado o leer un documento que has
          seleccionado).
        </li>
        <li>
          <strong>Almacenamiento:</strong> guardamos cifrados los tokens de acceso de Google y los
          metadatos imprescindibles (identificador y nombre del archivo). El contenido de los
          archivos solo se procesa mientras dura la tarea solicitada.
        </li>
        <li>
          <strong>Revocación:</strong> puedes desconectar Google desde la configuración de OlaBrain
          o en{" "}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          . Al desconectarlo, eliminamos los tokens almacenados.
        </li>
      </ul>
      <p>
        <strong>Uso limitado.</strong> El uso que OlaBrain hace de la información recibida de las
        API de Google, y su transferencia a cualquier otra aplicación, cumplen la{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          rel="noopener noreferrer"
        >
          Política de datos de usuario de los servicios de API de Google
        </a>
        , incluidos los requisitos de uso limitado (Limited Use).
      </p>
      <p>
        En concreto: (i) solo usamos esos datos para ofrecer o mejorar funciones visibles para ti
        dentro de OlaBrain; (ii) no los vendemos ni los transferimos a terceros, salvo a los
        proveedores imprescindibles para ejecutar la tarea que pides o cuando lo exija la ley; (iii)
        no los usamos para publicidad; (iv) ninguna persona los lee, salvo que nos des tu
        consentimiento expreso, por motivos de seguridad o para cumplir la ley; y (v) no los usamos
        para entrenar modelos de inteligencia artificial o aprendizaje automático generalizados.
      </p>

      <h2>Destinatarios de los datos</h2>
      <p>
        CLOUDIN no vende ni cede tus datos a terceros. Para prestar el servicio solo los comunicamos
        a proveedores que actúan como encargados del tratamiento, bajo contrato y siguiendo nuestras
        instrucciones:
      </p>
      <ul>
        <li>Alojamiento e infraestructura en la nube.</li>
        <li>
          Proveedores de modelos de inteligencia artificial que procesan las instrucciones y el
          contenido de tus agentes para generar respuestas, contratados con condiciones que les
          impiden usar tus datos para entrenar sus modelos.
        </li>
        <li>Procesador de pagos, correo electrónico transaccional y herramientas de soporte.</li>
      </ul>
      <p>
        Damos prioridad a proveedores ubicados en el Espacio Económico Europeo. Si alguno trata
        datos fuera de él, la transferencia se ampara en una decisión de adecuación de la Comisión
        Europea (como el Marco de Privacidad de Datos UE-EE. UU.) o en cláusulas contractuales tipo.
        Puedes pedir la lista actualizada de proveedores en{" "}
        <a href="mailto:hola@cloudin.pro">hola@cloudin.pro</a>.
      </p>

      <h2>Tiempo de conservación de los datos</h2>
      <p>El plazo de conservación depende de la finalidad para la que se recabaron los datos:</p>
      <ul>
        <li>
          <strong>Cuenta y contenido de OlaBrain:</strong> mientras la cuenta esté activa. Si la
          eliminas, borramos o anonimizamos los datos en un plazo de 30 días.
        </li>
        <li>
          <strong>Tokens de servicios conectados:</strong> hasta que desconectes el servicio o
          elimines tu cuenta.
        </li>
        <li>
          <strong>Consultas:</strong> hasta que estén contestadas.
        </li>
        <li>
          <strong>Newsletter:</strong> hasta que solicites la baja.
        </li>
        <li>
          <strong>Facturación:</strong> durante los plazos que exija la normativa fiscal y
          mercantil.
        </li>
        <li>
          <strong>Registros técnicos:</strong> hasta 12 meses.
        </li>
      </ul>
      <p>
        En cualquier caso, cuando termine la finalidad del tratamiento, CLOUDIN aplicará sus
        políticas de bloqueo y supresión de datos.
      </p>

      <h2>Derechos del titular de los datos</h2>
      <p>
        Puedes ejercer los derechos de acceso, rectificación, supresión, portabilidad, limitación y
        oposición al tratamiento escribiendo a{" "}
        <a href="mailto:hola@cloudin.pro">hola@cloudin.pro</a>. También puedes contactar con nuestro
        Delegado de Protección de Datos en esa misma dirección.
      </p>
      <p>
        Puedes retirar tu consentimiento en cualquier momento, sin efecto retroactivo, y oponerte a
        recibir comunicaciones electrónicas de CLOUDIN mediante el enlace que incluye cada
        comunicación.
      </p>
      <p>
        Si consideras que no hemos atendido correctamente tus derechos, puedes presentar una
        reclamación ante la Agencia Española de Protección de Datos (
        <a href="https://www.aepd.es" rel="noopener noreferrer">
          www.aepd.es
        </a>
        ).
      </p>

      <h2>Tratamiento de datos de menores de edad</h2>
      <p>
        OlaBrain está dirigido a profesionales y empresas. No está permitido facilitar datos de
        menores de edad a través de OlaBrain.
      </p>

      <h2>Seguridad</h2>
      <p>
        CLOUDIN ha adoptado las medidas técnicas y organizativas exigidas por la normativa de
        protección de datos para evitar la pérdida o el mal uso de los datos de carácter personal:
        cifrado en tránsito (HTTPS/TLS), cifrado de credenciales y tokens, control de acceso con el
        mínimo privilegio y copias de seguridad.
      </p>

      <h2>Enlaces</h2>
      <p>
        OlaBrain puede incluir enlaces a sitios web de terceros. CLOUDIN no se responsabiliza de los
        tratamientos de datos que lleven a cabo esos terceros; te recomendamos revisar sus avisos de
        privacidad.
      </p>

      <h2>Redes sociales</h2>
      <p>
        CLOUDIN tiene perfiles en distintas redes sociales y, como titular de esos perfiles, trata
        los datos en la medida en que cada red lo permite. CLOUDIN no extrae datos de las redes
        sociales salvo que lo haya solicitado previamente y haya obtenido el consentimiento expreso
        del titular para una finalidad concreta.
      </p>

      <h2>Cookies</h2>
      <p>
        OlaBrain usa cookies técnicas necesarias para iniciar sesión y mantener la sesión abierta.
        Si usamos cookies analíticas o de marketing, pediremos tu consentimiento previamente. Más
        detalles en la <a href="/cookies">Política de cookies</a>.
      </p>

      <h2>Modificación de la presente política</h2>
      <p>
        CLOUDIN se reserva el derecho de modificar esta política si cambian la legislación vigente o
        la doctrina jurisprudencial, o por criterios propios empresariales. Cualquier cambio se
        publicará en esta misma dirección y, si es relevante, te avisaremos por correo electrónico o
        dentro de la aplicación.
      </p>
    </LegalPage>
  );
}
