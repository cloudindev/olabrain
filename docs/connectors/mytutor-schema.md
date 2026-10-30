# MyTutor API: esquema observado

Generado por `apps/connector/scripts/mytutor-dump.ts` el 2026-10-30 (empresa 25). API no documentada: puede cambiar sin aviso.

## Autenticación (observada)

- `POST /v1/auth/login` con JSON `{email, password, rememberMe}`. 200 → cuerpo `{access_token, refresh_token, rememberMe, hasMultiCompanies}` y cookies HttpOnly en `.my-tutor.es`: `cookie_profieco` (acceso, JWT, 600 s) y `cookie_refresh_profieco` (renovación, 7 días, solo en las rutas `/v1/auth/refresh`, `/v1/auth/usuario/login-company` y `/v1/auth/impersonate`). 401 = credenciales incorrectas; 403 = la cuenta exige SSO.
- Las peticiones se autentican **solo con la cookie** `cookie_profieco`: con `Authorization: Bearer <access_token>` la API responde 403.
- `POST /v1/auth/refresh` con la cookie de renovación → `{access_token}` y una cookie de acceso nueva. El frontend renueva cuando quedan < 60 s o tras un 401.
- El JWT lleva `usuario_id`, `empresa_id`, `role`, `companies[{company_id, company_name, parentCompanyId}]`, `veosat_token` (SSO de ProfiFLEET) y otros indicadores.

## Listas

Parámetros: `companies`, `page`, `size`, `filter` (JSON: `[{p, v, r, t?, m?}]`), `sorting` (JSON). Respuesta `{rows, count}`.

### clients_all

`clients/tableCompany/Client` · HTTP 200 · 333 registros (count 333)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `extra_external_id` | string | 15.6 | → id |
| `corporate_name` | string | 0 |  |
| `brand_name` | string | 0 |  |
| `cif_nif` | string | 0 |  |
| `payment_method` | string | 0 |  |
| `paymentMonthDay` | null | 100 |  |
| `is_active` | boolean | 0 |  |
| `libraSendDate` | date | 25.5 |  |
| `updatedAt` | date | 0 |  |
| `companies` | array | 0 |  |
| `billing_emails` | array | 0 |  |
| `contact_phones` | array | 0 |  |
| `workplaces` | array | 0 |  |
| `worker` | null | 100 |  |

### clients_active

`clients/tableCompany/Client filter=[{"p":"is_active","v":"true","r":"eq","t":"boolean"}]` · HTTP 200 · 333 registros (count 333)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `extra_external_id` | string | 15.6 | → id |
| `corporate_name` | string | 0 |  |
| `brand_name` | string | 0 |  |
| `cif_nif` | string | 0 |  |
| `payment_method` | string | 0 |  |
| `paymentMonthDay` | null | 100 |  |
| `is_active` | boolean | 0 |  |
| `libraSendDate` | date | 25.5 |  |
| `updatedAt` | date | 0 |  |
| `companies` | array | 0 |  |
| `billing_emails` | array | 0 |  |
| `contact_phones` | array | 0 |  |
| `workplaces` | array | 0 |  |
| `worker` | null | 100 |  |

### suppliers_all

`clients/tableCompany/Supplier` · HTTP 200 · 2 registros (count 2)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `extra_external_id` | string | 50 | → id |
| `corporate_name` | string | 0 |  |
| `brand_name` | string | 0 |  |
| `cif_nif` | string | 0 |  |
| `payment_method` | string | 0 |  |
| `paymentMonthDay` | null | 100 |  |
| `is_active` | boolean | 0 |  |
| `libraSendDate` | null | 100 |  |
| `updatedAt` | date | 0 |  |
| `companies` | array | 0 |  |
| `billing_emails` | array | 0 |  |
| `contact_phones` | array | 0 |  |
| `workplaces` | array | 0 |  |
| `worker` | null | 100 |  |

### suppliers_active

`clients/tableCompany/Supplier filter=[{"p":"is_active","v":"true","r":"eq","t":"boolean"}]` · HTTP 200 · 2 registros (count 2)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `extra_external_id` | string | 50 | → id |
| `corporate_name` | string | 0 |  |
| `brand_name` | string | 0 |  |
| `cif_nif` | string | 0 |  |
| `payment_method` | string | 0 |  |
| `paymentMonthDay` | null | 100 |  |
| `is_active` | boolean | 0 |  |
| `libraSendDate` | null | 100 |  |
| `updatedAt` | date | 0 |  |
| `companies` | array | 0 |  |
| `billing_emails` | array | 0 |  |
| `contact_phones` | array | 0 |  |
| `workplaces` | array | 0 |  |
| `worker` | null | 100 |  |

### vehicles_all

`vehicles/table` · HTTP 200 · 58 registros (count 58)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `brand` | string | 0 |  |
| `type` | string | 0 |  |
| `model` | string | 0 |  |
| `horsepower` | string | 0 |  |
| `ACC` | boolean | 0 |  |
| `TPMS` | boolean | 0 |  |
| `gearbox` | string | 0 |  |
| `kilometers` | integer | 34.5 |  |
| `licensePlate` | string | 0 |  |
| `registrationDate` | date | 1.7 |  |
| `goodsType` | string | 0 |  |
| `transferType` | string | 0 |  |
| `assemblyType` | string | 0 |  |
| `utility` | string | 0 |  |
| `offRoad` | boolean | 0 |  |
| `driveType` | string | 0 |  |
| `referenceConsumption` | integer | 65.5 |  |
| `modularConfiguration` | string | 0 |  |
| `MMA` | integer | 56.9 |  |
| `tareWeight` | null | 100 |  |
| `PTO` | boolean | 0 |  |
| `cruiseControl` | string | 0 |  |
| `ecoRoll` | boolean | 0 |  |
| `geolocation` | boolean | 0 |  |
| `geolocationInstallDate` | date | 96.6 |  |
| `isDeregistered` | boolean | 0 |  |
| `phone` | null | 100 |  |
| `externalSource` | null | 100 |  |
| `externalId` | null | 100 | → id |
| `externalIdUpdatedAt` | null | 100 |  |
| `companyId` | integer | 0 | → id |
| `workerId` | null | 100 | → id |
| `vehicleConfigId` | null | 100 | → id |
| `upcId` | null | 100 | → id |
| `deletedAt` | null | 100 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `upc_id` | null | 100 | → id |
| `telematic` | null | 100 |  |

### vehicles_active

`vehicles/table filter=[{"p":"is_active","v":"true","r":"eq","t":"boolean"}]` · HTTP 400 · 0 registros

Error: HTTP 400: {"message":"Invalid filter property: is_active","error":"Bad Request","statusCode":400}

### workers_all

`workers/table-workers` · HTTP 200 · 55 registros (count 55)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `name` | string | 0 |  |
| `surname` | string | 0 |  |
| `fullName` | string | 0 |  |
| `NIF` | string | 0 |  |
| `nationality` | string | 0 |  |
| `birthdate` | date | 18.2 |  |
| `email` | string | 0 |  |
| `ssoMail` | string | 27.3 |  |
| `personalEmail` | null | 100 |  |
| `personalPhone` | string | 0 |  |
| `address` | string | 0 |  |
| `addressDetails` | string | 18.2 |  |
| `postalCode` | string | 18.2 |  |
| `townIneCode` | integer | 12.7 |  |
| `provinceIneCode` | integer | 3.6 |  |
| `companyId` | integer | 0 | → id |
| `registrationDate` | date | 0 |  |
| `companyWorkplaceId` | integer | 18.2 | → id |
| `vehicleId` | integer | 1.8 | → id |
| `companyPhone` | string | 0 |  |
| `observations` | string | 0 |  |
| `terminationDate` | null | 100 |  |
| `isActive` | boolean | 0 |  |
| `externalId` | null | 100 | → id |
| `dfmExternalId` | null | 100 | → id |
| `dfmUpdatedAtExternal` | null | 100 |  |
| `extraData` | null | 100 |  |
| `listUnmetRequirements` | array | 0 |  |
| `updatedAtExternal` | null | 100 |  |
| `positionId` | integer | 0 | → id |
| `subpositionId` | null | 100 | → id |
| `photoFileId` | null | 100 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `workerCompanies` | array | 0 |  |
| `user` | object | 45.5 |  |
| `user.usuario_id` | integer | 45.5 | → id |
| `user.nombre` | string | 45.5 |  |
| `user.apellidos` | string | 45.5 |  |
| `user.email` | string | 45.5 |  |
| `user.ssoMail` | string | 58.2 |  |
| `user.password` | string | 45.5 |  |
| `user.password_hash` | string | 54.5 |  |
| `user.password_reset_hash` | string | 90.9 |  |
| `user.password_reset_expiry` | date | 90.9 |  |
| `user.verification` | boolean | 45.5 |  |
| `user.usuario` | string | 45.5 |  |
| `user.dni` | string | 47.3 |  |
| `user.telefono` | string | 45.5 |  |
| `user.veosat_token` | string | 47.3 |  |
| `user.usuarioRuptela` | null | 100 |  |
| `user.role` | array | 45.5 |  |
| `user.logo_path` | null | 100 |  |
| `user.is_temporal_password` | boolean | 45.5 |  |
| `user.has_been_welcomed` | boolean | 45.5 |  |
| `user.has_veosat_historical_telemetry` | boolean | 45.5 |  |
| `user.empresa_id` | integer | 45.5 | → id |
| `user.conductor_id` | integer | 70.9 | → id |
| `user.worker_id` | integer | 45.5 | → id |
| `user.createdAt` | date | 47.3 |  |
| `user.updatedAt` | date | 45.5 |  |
| `user.deletedAt` | null | 100 |  |
| `user.userCompanies` | array | 45.5 |  |
| `certifications` | array | 0 |  |
| `unmetRequirements` | array | 0 |  |

### workers_active

`workers/table-workers filter=[{"p":"worker_status","v":"active","r":"like","m":"workerCompanies"}]` · HTTP 200 · 54 registros (count 54)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `name` | string | 0 |  |
| `surname` | string | 0 |  |
| `fullName` | string | 0 |  |
| `NIF` | string | 0 |  |
| `nationality` | string | 0 |  |
| `birthdate` | date | 18.5 |  |
| `email` | string | 0 |  |
| `ssoMail` | string | 27.8 |  |
| `personalEmail` | null | 100 |  |
| `personalPhone` | string | 0 |  |
| `address` | string | 0 |  |
| `addressDetails` | string | 18.5 |  |
| `postalCode` | string | 18.5 |  |
| `townIneCode` | integer | 13 |  |
| `provinceIneCode` | integer | 3.7 |  |
| `companyId` | integer | 0 | → id |
| `registrationDate` | date | 0 |  |
| `companyWorkplaceId` | integer | 18.5 | → id |
| `vehicleId` | integer | 1.9 | → id |
| `companyPhone` | string | 0 |  |
| `observations` | string | 0 |  |
| `terminationDate` | null | 100 |  |
| `isActive` | boolean | 0 |  |
| `externalId` | null | 100 | → id |
| `dfmExternalId` | null | 100 | → id |
| `dfmUpdatedAtExternal` | null | 100 |  |
| `extraData` | null | 100 |  |
| `listUnmetRequirements` | array | 0 |  |
| `updatedAtExternal` | null | 100 |  |
| `positionId` | integer | 0 | → id |
| `subpositionId` | null | 100 | → id |
| `photoFileId` | null | 100 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `workerCompanies` | array | 0 |  |
| `user` | object | 46.3 |  |
| `user.usuario_id` | integer | 46.3 | → id |
| `user.nombre` | string | 46.3 |  |
| `user.apellidos` | string | 46.3 |  |
| `user.email` | string | 46.3 |  |
| `user.ssoMail` | string | 59.3 |  |
| `user.password` | string | 46.3 |  |
| `user.password_hash` | string | 55.6 |  |
| `user.password_reset_hash` | string | 90.7 |  |
| `user.password_reset_expiry` | date | 90.7 |  |
| `user.verification` | boolean | 46.3 |  |
| `user.usuario` | string | 46.3 |  |
| `user.dni` | string | 48.1 |  |
| `user.telefono` | string | 46.3 |  |
| `user.veosat_token` | string | 48.1 |  |
| `user.usuarioRuptela` | null | 100 |  |
| `user.role` | array | 46.3 |  |
| `user.logo_path` | null | 100 |  |
| `user.is_temporal_password` | boolean | 46.3 |  |
| `user.has_been_welcomed` | boolean | 46.3 |  |
| `user.has_veosat_historical_telemetry` | boolean | 46.3 |  |
| `user.empresa_id` | integer | 46.3 | → id |
| `user.conductor_id` | integer | 72.2 | → id |
| `user.worker_id` | integer | 46.3 | → id |
| `user.createdAt` | date | 48.1 |  |
| `user.updatedAt` | date | 46.3 |  |
| `user.deletedAt` | null | 100 |  |
| `user.userCompanies` | array | 46.3 |  |
| `certifications` | array | 0 |  |
| `unmetRequirements` | array | 0 |  |

### tach_vehicles

`profitach/vehicles` · HTTP 200 · 17 registros (count 17)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `companyId` | integer | 0 | → id |
| `providerVehicleId` | string | 0 | → id |
| `registrationNumber` | string | 0 |  |
| `lastDownloadedAt` | date | 11.8 |  |
| `status` | string | 0 |  |
| `lastConnected` | date | 11.8 |  |
| `disabled` | boolean | 0 |  |
| `hasGlobalSchedule` | boolean | 0 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `companyName` | string | 0 |  |
| `isLinkedInProfidata` | boolean | 0 |  |

### tach_driver_cards

`profitach/driver-cards` · HTTP 200 · 27 registros (count 27)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `companyId` | integer | 0 | → id |
| `providerDriverCardId` | string | 0 | → id |
| `cardNumber` | string | 0 |  |
| `holderFirstName` | string | 0 |  |
| `holderLastName` | string | 3.7 |  |
| `lastDownloadedAt` | date | 44.4 |  |
| `lastConnected` | date | 44.4 |  |
| `lastActivity` | string | 0 |  |
| `lastVehicleId` | integer | 44.4 | → id |
| `lastVehicleNumber` | string | 44.4 |  |
| `disabled` | boolean | 0 |  |
| `hasGlobalSchedule` | boolean | 0 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `companyName` | string | 0 |  |
| `dni` | string | 3.7 |  |
| `isLinkedInProfidata` | boolean | 0 |  |

### tach_files

`profitach/files` · HTTP 200 · 171 registros (count 171)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `companyId` | integer | 0 | → id |
| `providerFileId` | string | 0 | → id |
| `vehicleId` | integer | 46.2 | → id |
| `driverCardId` | integer | 53.8 | → id |
| `type` | string | 0 |  |
| `generation` | null | 100 |  |
| `downloadedAt` | date | 0 |  |
| `status` | string | 0 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `vehicle` | object | 46.2 |  |
| `vehicle.registrationNumber` | string | 46.2 |  |
| `driverCard` | object | 53.8 |  |
| `analysis` | object | 0 |  |
| `analysis.status` | string | 0 |  |
| `analysis.fromDate` | null | 100 |  |
| `analysis.toDate` | null | 100 |  |
| `isStoredLocally` | boolean | 0 |  |
| `vehicleRegistrationNumber` | string | 46.2 |  |
| `driverCardNumber` | string | 53.8 |  |
| `analysisStatus` | string | 0 |  |
| `coverageFrom` | null | 100 |  |
| `coverageTo` | null | 100 |  |
| `driverCard.cardNumber` | string | 53.8 |  |

### tach_synchronizations

`profitach/synchronizations` · HTTP 200 · 82 registros (count 82)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `companyId` | integer | 0 | → id |
| `providerConnectionId` | integer | 0 | → id |
| `status` | string | 0 |  |
| `mode` | string | 0 |  |
| `syncedFrom` | date | 1.2 |  |
| `startedAt` | date | 0 |  |
| `finishedAt` | date | 0 |  |
| `vehiclesImported` | integer | 35.4 |  |
| `driverCardsImported` | integer | 35.4 |  |
| `filesImported` | integer | 35.4 |  |
| `errorMessage` | string | 64.6 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |

### tach_download_history

`profitach/download-history` · HTTP 200 · 127 registros (count 127)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `companyId` | integer | 0 | → id |
| `providerConnectionId` | integer | 0 | → id |
| `providerHistoryId` | string | 0 | → id |
| `vehicleId` | integer | 0 | → id |
| `driverCardId` | null | 100 | → id |
| `fileId` | null | 100 | → id |
| `downloadType` | string | 0 |  |
| `driverName` | string | 71.7 |  |
| `status` | string | 0 |  |
| `startedAt` | date | 0 |  |
| `finishedAt` | date | 0 |  |
| `errorMessage` | null | 100 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `vehicle` | object | 0 |  |
| `vehicle.registrationNumber` | string | 0 |  |
| `driverCard` | null | 100 |  |
| `vehicleRegistrationNumber` | string | 0 |  |
| `driverCardNumber` | null | 100 |  |

### consignment_notes

`consignment-notes` · HTTP 200 · 7 registros (count 7)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `deliveryNoteNumber` | string | 0 |  |
| `pickupDate` | date | 0 |  |
| `loaderId` | integer | 0 | → id |
| `destinationId` | integer | 0 | → id |
| `shipperId` | integer | 0 | → id |
| `carrierId` | integer | 0 | → id |
| `deliveryPlace` | string | 0 |  |
| `externalDriverName` | string | 85.7 |  |
| `externalNIE` | null | 100 |  |
| `externalEmail` | null | 100 |  |
| `externalPhone` | null | 100 |  |
| `externalAccessToken` | null | 100 |  |
| `originPlace` | string | 0 |  |
| `status` | string | 0 |  |
| `serviceType` | string | 0 |  |
| `price` | integer | 14.3 |  |
| `isLegacy` | boolean | 0 |  |
| `uuid` | string | 14.3 |  |
| `isImported` | null | 100 |  |
| `traveledDistance` | null | 100 |  |
| `traveledGoDistance` | null | 100 |  |
| `traveledBackDistance` | null | 100 |  |
| `downtimeHours` | null | 100 |  |
| `requiredSignatures` | array | 0 |  |
| `isLoaded` | boolean | 0 |  |
| `currentRevision` | integer | 0 |  |
| `externalId` | null | 100 | → id |
| `externalRevision` | null | 100 |  |
| `companyId` | integer | 0 | → id |
| `pdfFileId` | integer | 0 | → id |
| `certificateFileId` | null | 100 | → id |
| `workerId` | integer | 14.3 | → id |
| `servicesTotalPrice` | null | 100 |  |
| `deletedAt` | null | 100 |  |
| `updatedAt` | date | 0 |  |
| `createdAt` | date | 0 |  |
| `loader_client_workplace_id` | null | 100 | → id |
| `loader` | object | 0 |  |
| `loader.id` | integer | 0 | → id |
| `loader.clientId` | integer | 14.3 | → id |
| `loader.clientWorkplaceId` | integer | 42.9 | → id |
| `loader.companyId` | null | 100 | → id |
| `loader.companyWorkplaceId` | null | 100 | → id |
| `loader.consignmentNoteCompanyId` | integer | 0 | → id |
| `loader.corporateName` | string | 0 |  |
| `loader.brandName` | string | 0 |  |
| `loader.cifNif` | string | 0 |  |
| `loader.address` | string | 0 |  |
| `loader.email` | string | 14.3 |  |
| `loader.town` | string | 0 |  |
| `loader.province` | string | 0 |  |
| `loader.postalCode` | string | 0 |  |
| `loader.phone` | string | 0 |  |
| `loader.simpleAddress` | null | 100 |  |
| `loader.model` | null | 100 |  |
| `loader.modelId` | null | 100 | → id |
| `loader.createdAt` | date | 0 |  |
| `loader.updatedAt` | date | 0 |  |
| `destination` | object | 0 |  |
| `destination.id` | integer | 0 | → id |
| `destination.clientId` | integer | 14.3 | → id |
| `destination.clientWorkplaceId` | integer | 57.1 | → id |
| `destination.companyId` | null | 100 | → id |
| `destination.companyWorkplaceId` | null | 100 | → id |
| `destination.consignmentNoteCompanyId` | integer | 0 | → id |
| `destination.corporateName` | string | 0 |  |
| `destination.brandName` | string | 0 |  |
| `destination.cifNif` | string | 0 |  |
| `destination.address` | string | 0 |  |
| `destination.email` | string | 14.3 |  |
| `destination.town` | string | 0 |  |
| `destination.province` | string | 0 |  |
| `destination.postalCode` | string | 0 |  |
| `destination.phone` | string | 0 |  |
| `destination.simpleAddress` | null | 100 |  |
| `destination.model` | null | 100 |  |
| `destination.modelId` | null | 100 | → id |
| `destination.createdAt` | date | 0 |  |
| `destination.updatedAt` | date | 0 |  |
| `shipper` | object | 0 |  |
| `shipper.id` | integer | 0 | → id |
| `shipper.clientId` | integer | 0 | → id |
| `shipper.clientWorkplaceId` | integer | 57.1 | → id |
| `shipper.companyId` | null | 100 | → id |
| `shipper.companyWorkplaceId` | null | 100 | → id |
| `shipper.consignmentNoteCompanyId` | integer | 0 | → id |
| `shipper.corporateName` | string | 0 |  |
| `shipper.brandName` | string | 0 |  |
| `shipper.cifNif` | string | 0 |  |
| `shipper.address` | string | 0 |  |
| `shipper.email` | string | 14.3 |  |
| `shipper.town` | string | 0 |  |
| `shipper.province` | string | 0 |  |
| `shipper.postalCode` | string | 0 |  |
| `shipper.phone` | string | 0 |  |
| `shipper.simpleAddress` | null | 100 |  |
| `shipper.model` | null | 100 |  |
| `shipper.modelId` | null | 100 | → id |
| `shipper.createdAt` | date | 0 |  |
| `shipper.updatedAt` | date | 0 |  |
| `carrier` | object | 0 |  |
| `carrier.id` | integer | 0 | → id |
| `carrier.clientId` | integer | 85.7 | → id |
| `carrier.clientWorkplaceId` | null | 100 | → id |
| `carrier.companyId` | integer | 14.3 | → id |
| `carrier.companyWorkplaceId` | integer | 14.3 | → id |
| `carrier.consignmentNoteCompanyId` | integer | 0 | → id |
| `carrier.corporateName` | string | 0 |  |
| `carrier.brandName` | string | 0 |  |
| `carrier.cifNif` | string | 0 |  |
| `carrier.address` | string | 0 |  |
| `carrier.email` | string | 0 |  |
| `carrier.town` | string | 0 |  |
| `carrier.province` | string | 0 |  |
| `carrier.postalCode` | string | 0 |  |
| `carrier.phone` | string | 0 |  |
| `carrier.simpleAddress` | null | 100 |  |
| `carrier.model` | null | 100 |  |
| `carrier.modelId` | null | 100 | → id |
| `carrier.createdAt` | date | 0 |  |
| `carrier.updatedAt` | date | 0 |  |
| `goods` | object | 0 |  |
| `goods.nature` | string | 14.3 |  |
| `goods.denomination` | string | 0 |  |
| `plates` | array | 0 |  |
| `worker` | object | 14.3 |  |
| `worker.id` | integer | 14.3 | → id |
| `worker.name` | string | 14.3 |  |
| `worker.surname` | string | 14.3 |  |
| `company` | object | 0 |  |
| `company.companyId` | integer | 0 | → id |
| `company.name` | string | 0 |  |
| `company.brandName` | string | 0 |  |
| `services` | array | 0 |  |
| `additionalDrivers` | array | 0 |  |
| `signatures` | array | 0 |  |
| `consignmentNoteAlerts` | array | 0 |  |

### invoices_all

`invoices/table` · HTTP 200 · 1 registros (count 1)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `user_id` | integer | 0 | → id |
| `operation_date` | date | 0 |  |
| `seriesId` | integer | 0 | → id |
| `serie` | object | 0 |  |
| `serie.id` | integer | 0 | → id |
| `serie.company_id` | integer | 0 | → id |
| `serie.serial` | string | 0 |  |
| `serie.type` | string | 0 |  |
| `serie.is_default` | boolean | 0 |  |
| `serie.createdAt` | date | 0 |  |
| `serie.updatedAt` | date | 0 |  |
| `serie.deletedAt` | null | 100 |  |
| `company_id` | integer | 0 | → id |
| `invoice_format` | string | 0 |  |
| `supplier` | object | 0 |  |
| `supplier.crm_id` | integer | 0 | → id |
| `supplier.name` | string | 0 |  |
| `supplier.cif` | string | 0 |  |
| `supplier.address` | string | 0 |  |
| `supplier.email` | string | 0 |  |
| `supplier.city` | string | 0 |  |
| `supplier.postal_code` | string | 0 |  |
| `supplier.country_id` | integer | 0 | → id |
| `supplier.province_id` | integer | 0 | → id |
| `supplier.province` | string | 0 |  |
| `client` | object | 0 |  |
| `client.crm_id` | integer | 0 | → id |
| `client.name` | string | 0 |  |
| `client.cif` | string | 0 |  |
| `client.address` | string | 0 |  |
| `client.city` | string | 0 |  |
| `client.postal_code` | string | 0 |  |
| `client.province` | string | 0 |  |
| `client.province_id` | integer | 0 | → id |
| `client.country_id` | integer | 0 | → id |
| `client.phone` | string | 0 |  |
| `client.email` | string | 0 |  |
| `client.IBAN` | string | 0 |  |
| `client_workplace_id` | integer | 0 | → id |
| `transaction_date` | date | 0 |  |
| `invoice_date` | date | 0 |  |
| `invoice_number` | string | 0 |  |
| `price_net_value` | integer | 0 |  |
| `taxes_percent` | string | 0 |  |
| `taxes_type` | string | 0 |  |
| `apply_taxes` | boolean | 0 |  |
| `taxes_amount` | number | 0 |  |
| `verifactuData` | null | 100 |  |
| `final_price` | number | 0 |  |
| `user_email` | string | 0 |  |
| `email_billing` | array | 0 |  |
| `status` | string | 0 |  |
| `discount` | null | 100 |  |
| `discount_types` | null | 100 |  |
| `discount_description` | string | 0 |  |
| `apply_irpf` | boolean | 0 |  |
| `irpf_percent` | string | 0 |  |
| `irpf_amount` | integer | 0 |  |
| `comments` | string | 0 |  |
| `due_date` | date | 0 |  |
| `payment_method` | string | 0 |  |
| `isDemo` | boolean | 0 |  |
| `invoice_file_name` | string | 0 |  |
| `corrective_id` | null | 100 | → id |
| `original_invoice_id` | null | 100 | → id |
| `ticketBAIData` | null | 100 |  |
| `pdf_file_id` | integer | 0 | → id |
| `xml_file_id` | integer | 0 | → id |
| `items` | array | 0 |  |

### invoices_2026

`invoices/table filter=[{"p":"invoice_date","v":"{\"from\":\"2026-01-01T00:00:00.000Z\",\"to\":\"2027-01-01T00:00:00.000Z\"}","r":"like","t":"dateRange"}]` · HTTP 200 · 0 registros (count 0)

Sin campos.

### waste_work_orders

`waste-work-order/table-info` · HTTP 200 · 15389 registros (count 15389)

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `status` | string | 0 |  |
| `truck_type` | string | 0.1 |  |
| `start_date` | date | 0.1 |  |
| `call_date` | date | 0 |  |
| `service_type` | string | 0 |  |
| `license_plate` | string | 0 |  |
| `external_dcs_number` | string | 99 |  |
| `comments` | string | 0 |  |
| `driver_indications` | string | 78.6 |  |
| `client_id` | integer | 0 | → id |
| `client_file_id` | integer | 99.9 | → id |
| `waste_transfer_notice_id` | integer | 91 | → id |
| `waste_identification_document_id` | integer | 67.8 | → id |
| `workplace_id` | integer | 0 | → id |
| `destination_id` | integer | 18.1 | → id |
| `destination_workplace_id` | integer | 18.1 | → id |
| `company_id` | integer | 0 | → id |
| `driver_id` | integer | 98.3 | → id |
| `worker_id` | integer | 0.1 | → id |
| `user_id` | integer | 0.5 | → id |
| `mandatory_ticket` | boolean | 0 |  |
| `operator_id` | integer | 99.5 | → id |
| `operator_workplace_id` | integer | 99.5 | → id |
| `transporter_id` | integer | 99.1 | → id |
| `transporter_workplace_id` | integer | 99.1 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `deletedAt` | null | 100 |  |
| `work_order_services` | array | 0 |  |
| `services` | array | 0 |  |
| `user` | object | 0.5 |  |
| `user.usuario_id` | integer | 0.5 | → id |
| `user.nombre` | string | 0.5 |  |
| `user.apellidos` | string | 0.5 |  |
| `user.email` | string | 0.5 |  |
| `user.ssoMail` | string | 64.7 |  |
| `user.password` | string | 0.5 |  |
| `user.password_hash` | string | 0.5 |  |
| `user.password_reset_hash` | string | 0.5 |  |
| `user.password_reset_expiry` | date | 0.5 |  |
| `user.verification` | boolean | 0.5 |  |
| `user.usuario` | string | 0.5 |  |
| `user.dni` | string | 35.8 |  |
| `user.telefono` | string | 0.5 |  |
| `user.veosat_token` | string | 0.5 |  |
| `user.usuarioRuptela` | null | 100 |  |
| `user.role` | array | 0.5 |  |
| `user.logo_path` | null | 100 |  |
| `user.is_temporal_password` | boolean | 0.5 |  |
| `user.has_been_welcomed` | boolean | 0.5 |  |
| `user.has_veosat_historical_telemetry` | boolean | 0.5 |  |
| `user.empresa_id` | integer | 0.5 | → id |
| `user.conductor_id` | null | 100 | → id |
| `user.worker_id` | integer | 64.7 | → id |
| `user.createdAt` | date | 35.8 |  |
| `user.updatedAt` | date | 0.5 |  |
| `user.deletedAt` | null | 100 |  |
| `waste_identification_document` | object | 67.8 |  |
| `waste_identification_document.id` | integer | 67.8 | → id |
| `waste_identification_document.document_number` | string | 67.8 |  |
| `waste_identification_document.start_date` | date | 67.8 |  |
| `waste_identification_document.waste_information_id` | integer | 67.8 | → id |
| `waste_identification_document.waste_transfer_notice_id` | integer | 94.4 | → id |
| `waste_identification_document.company_id` | integer | 67.8 | → id |
| `waste_identification_document.pdf_file_name` | string | 73.4 |  |
| `waste_identification_document.transporter_crm_id` | integer | 67.8 | → id |
| `waste_identification_document.transporter_workplace_id` | integer | 67.8 | → id |
| `waste_identification_document.transporter_nif` | string | 67.8 |  |
| `waste_identification_document.transporter_name` | string | 67.8 |  |
| `waste_identification_document.transporter_nima` | string | 67.8 |  |
| `waste_identification_document.transporter_type` | string | 67.8 |  |
| `waste_identification_document.transporter_address` | string | 67.8 |  |
| `waste_identification_document.transporter_town_ine_code` | integer | 67.8 |  |
| `waste_identification_document.transporter_province_ine_code` | integer | 67.8 |  |
| `waste_identification_document.transporter_postal_code` | string | 67.8 |  |
| `waste_identification_document.transporter_phone` | string | 67.8 |  |
| `waste_identification_document.transporter_email` | string | 67.8 |  |
| `waste_identification_document.transporter_brand_name` | string | 67.8 |  |
| `waste_identification_document.transporter_registration_number` | string | 67.8 |  |
| `waste_identification_document.transporter_reason_association_co` | string | 67.8 |  |
| `waste_identification_document.transporter_entity_fj_code` | string | 67.8 |  |
| `waste_identification_document.transporter_vial_code` | string | 67.8 |  |
| `waste_identification_document.transporter_activity` | string | 67.8 |  |
| `waste_identification_document.operator_crm_id` | integer | 67.8 | → id |
| `waste_identification_document.operator_workplace_id` | integer | 67.8 | → id |
| `waste_identification_document.operator_nif` | string | 67.8 |  |
| `waste_identification_document.operator_name` | string | 67.8 |  |
| `waste_identification_document.operator_vial_code` | string | 67.8 |  |
| `waste_identification_document.operator_nima` | string | 67.8 |  |
| `waste_identification_document.operator_registration_number` | string | 67.8 |  |
| `waste_identification_document.operator_entity_fj_code` | string | 67.8 |  |
| `waste_identification_document.operator_reason_association_code` | string | 67.8 |  |
| `waste_identification_document.operator_type` | string | 67.8 |  |
| `waste_identification_document.operator_address` | string | 67.8 |  |
| `waste_identification_document.operator_municipality` | string | 67.8 |  |
| `waste_identification_document.operator_town_ine_code` | integer | 67.8 |  |
| `waste_identification_document.operator_province` | string | 67.8 |  |
| `waste_identification_document.operator_activity` | string | 67.8 |  |
| `waste_identification_document.operator_province_ine_code` | integer | 67.8 |  |
| `waste_identification_document.operator_postal_code` | string | 67.8 |  |
| `waste_identification_document.operator_phone` | string | 67.8 |  |
| `waste_identification_document.operator_email` | string | 67.8 |  |
| `waste_identification_document.operator_brand_name` | string | 67.8 |  |
| `waste_identification_document.origin_crm_id` | integer | 67.8 | → id |
| `waste_identification_document.origin_workplace_id` | integer | 67.8 | → id |
| `waste_identification_document.origin_nif` | string | 67.8 |  |
| `waste_identification_document.origin_name` | string | 67.8 |  |
| `waste_identification_document.origin_nima` | string | 67.8 |  |
| `waste_identification_document.origin_registration_number` | string | 67.8 |  |
| `waste_identification_document.origin_vial_code` | string | 67.8 |  |
| `waste_identification_document.origin_reason_association_code` | string | 67.8 |  |
| `waste_identification_document.origin_entity_fj_code` | string | 67.8 |  |
| `waste_identification_document.origin_center_type` | string | 67.8 |  |
| `waste_identification_document.origin_activity` | string | 67.8 |  |
| `waste_identification_document.origin_address` | string | 67.8 |  |
| `waste_identification_document.origin_municipality` | string | 67.8 |  |
| `waste_identification_document.origin_town_ine_code` | integer | 67.8 |  |
| `waste_identification_document.origin_province` | string | 67.8 |  |
| `waste_identification_document.origin_province_ine_code` | integer | 67.8 |  |
| `waste_identification_document.origin_postal_code` | string | 67.8 |  |
| `waste_identification_document.origin_phone` | string | 67.8 |  |
| `waste_identification_document.origin_email` | string | 67.8 |  |
| `waste_identification_document.origin_brand_name` | string | 67.8 |  |
| `waste_identification_document.destination_crm_id` | integer | 67.8 | → id |
| `waste_identification_document.destination_workplace_id` | integer | 67.8 | → id |
| `waste_identification_document.destination_nif` | string | 67.8 |  |
| `waste_identification_document.destination_name` | string | 67.8 |  |
| `waste_identification_document.destination_nima` | string | 67.8 |  |
| `waste_identification_document.destination_vial_code` | string | 67.8 |  |
| `waste_identification_document.destination_activity` | string | 67.8 |  |
| `waste_identification_document.destination_registration_number` | string | 67.8 |  |
| `waste_identification_document.destination_reason_association_co` | string | 67.8 |  |
| `waste_identification_document.destination_entity_fj_code` | string | 67.8 |  |
| `waste_identification_document.destination_center_type` | string | 67.8 |  |
| `waste_identification_document.destination_address` | string | 67.8 |  |
| `waste_identification_document.destination_municipality` | string | 67.8 |  |
| `waste_identification_document.destination_town_ine_code` | integer | 67.8 |  |
| `waste_identification_document.destination_province` | string | 67.8 |  |
| `waste_identification_document.destination_province_ine_code` | integer | 67.8 |  |
| `waste_identification_document.destination_postal_code` | string | 67.8 |  |
| `waste_identification_document.destination_phone` | string | 67.8 |  |
| `waste_identification_document.destination_email` | string | 67.8 |  |
| `waste_identification_document.destination_brand_name` | string | 67.8 |  |
| `waste_identification_document.cvs` | string | 94.5 |  |
| `waste_identification_document.DCSPhase` | string | 94.4 |  |
| `waste_identification_document.createdAt` | date | 67.8 |  |
| `waste_identification_document.updatedAt` | date | 67.8 |  |
| `client_file` | object | 99.9 |  |
| `client` | object | 0 |  |
| `client.id` | integer | 0 | → id |
| `client.empresa_id` | integer | 0 | → id |
| `client.corporate_name` | string | 0 |  |
| `client.client_email` | string | 0 |  |
| `client.brand_name` | string | 0 |  |
| `client.cif_nif` | string | 0 |  |
| `client.address` | string | 0 |  |
| `client.town_ine_code` | integer | 0 |  |
| `client.postal_code` | string | 0 |  |
| `client.country_code` | string | 0 |  |
| `client.province_ine_code` | integer | 0 |  |
| `client.billing_manager` | string | 0 |  |
| `client.comments` | string | 0 |  |
| `client.reason_association_code` | string | 0 |  |
| `client.entity_fj_code` | string | 0 |  |
| `client.vial_code` | string | 0 |  |
| `client.payment_method` | string | 0 |  |
| `client.paymentMonthDay` | null | 100 |  |
| `client.payment_comments` | string | 0 |  |
| `client.IBAN` | string | 0 |  |
| `client.payment_term` | integer | 0 |  |
| `client.external_id` | null | 100 | → id |
| `client.is_active` | boolean | 0 |  |
| `client.type` | array | 0 |  |
| `client.worker_id` | null | 100 | → id |
| `client.libraSendDate` | date | 0.3 |  |
| `client.extra_external_id` | string | 2.7 | → id |
| `client.face_accounting_office` | null | 100 |  |
| `client.face_managing_body` | null | 100 |  |
| `client.face_processing_unit` | null | 100 |  |
| `client.invoice_receiver_type` | string | 0 |  |
| `client.faceb2b_receiver_dire_code` | null | 100 |  |
| `client.updatedAt` | date | 0 |  |
| `client.deletedAt` | null | 100 |  |
| `client.createdAt` | date | 0 |  |
| `destination` | object | 18.1 |  |
| `workplace` | object | 1.1 |  |
| `workplace.id` | integer | 1.1 | → id |
| `workplace.client_id` | integer | 1.1 | → id |
| `workplace.corporate_name` | string | 1.1 |  |
| `workplace.isActive` | boolean | 1.1 |  |
| `workplace.country_code` | string | 1.1 |  |
| `workplace.cif_nif` | string | 1.1 |  |
| `workplace.address` | string | 1.1 |  |
| `workplace.reason_association_code` | string | 1.1 |  |
| `workplace.entity_fj_code` | string | 1.1 |  |
| `workplace.vial_code` | string | 1.1 |  |
| `workplace.town_ine_code` | integer | 1.1 |  |
| `workplace.postal_code` | string | 1.1 |  |
| `workplace.province_ine_code` | integer | 1.1 |  |
| `workplace.center_manager` | string | 1.1 |  |
| `workplace.phone` | string | 1.1 |  |
| `workplace.email` | string | 1.1 |  |
| `workplace.comments` | string | 1.1 |  |
| `workplace.billing_emails` | array | 28.5 |  |
| `workplace.external_id` | string | 82.7 | → id |
| `workplace.brand_name` | string | 1.1 |  |
| `workplace.deletedAt` | null | 100 |  |
| `workplace.createdAt` | date | 1.1 |  |
| `workplace.updatedAt` | date | 1.1 |  |
| `workplace.town` | object | 1.1 |  |
| `workplace.province` | object | 1.1 |  |
| `destination_workplace` | object | 18.1 |  |
| `waste_transfer_notice` | object | 91 |  |
| `worker` | object | 0.1 |  |
| `worker.id` | integer | 0.1 | → id |
| `worker.name` | string | 0.1 |  |
| `worker.surname` | string | 0.1 |  |
| `worker.fullName` | string | 0.1 |  |
| `worker.NIF` | string | 0.1 |  |
| `worker.nationality` | string | 0.1 |  |
| `worker.birthdate` | date | 26.4 |  |
| `worker.email` | string | 0.1 |  |
| `worker.ssoMail` | string | 29.2 |  |
| `worker.personalEmail` | null | 100 |  |
| `worker.personalPhone` | string | 0.1 |  |
| `worker.address` | string | 0.1 |  |
| `worker.addressDetails` | string | 26.4 |  |
| `worker.postalCode` | string | 26.4 |  |
| `worker.townIneCode` | integer | 9.5 |  |
| `worker.provinceIneCode` | integer | 0.1 |  |
| `worker.companyId` | integer | 0.1 | → id |
| `worker.registrationDate` | date | 0.1 |  |
| `worker.companyWorkplaceId` | integer | 26.4 | → id |
| `worker.vehicleId` | integer | 0.1 | → id |
| `worker.companyPhone` | string | 0.1 |  |
| `worker.observations` | string | 0.1 |  |
| `worker.terminationDate` | null | 100 |  |
| `worker.isActive` | boolean | 0.1 |  |
| `worker.externalId` | null | 100 | → id |
| `worker.dfmExternalId` | null | 100 | → id |
| `worker.dfmUpdatedAtExternal` | null | 100 |  |
| `worker.extraData` | null | 100 |  |
| `worker.listUnmetRequirements` | array | 0.1 |  |
| `worker.updatedAtExternal` | null | 100 |  |
| `worker.positionId` | integer | 0.1 | → id |
| `worker.subpositionId` | null | 100 | → id |
| `worker.photoFileId` | null | 100 | → id |
| `worker.createdAt` | date | 0.1 |  |
| `worker.updatedAt` | date | 0.1 |  |
| `waste_transfer_notice.id` | integer | 91 | → id |
| `waste_transfer_notice.notification_number` | string | 91 |  |
| `waste_transfer_notice.notification_type` | string | 91 |  |
| `waste_transfer_notice.start_date` | date | 91 |  |
| `waste_transfer_notice.end_date` | date | 91 |  |
| `waste_transfer_notice.transfer_frequency` | string | 91 |  |
| `waste_transfer_notice.emergency_situation` | boolean | 91 |  |
| `waste_transfer_notice.emergency_reason` | string | 91 |  |
| `waste_transfer_notice.is_active` | boolean | 91 |  |
| `waste_transfer_notice.operator_crm_id` | integer | 91 | → id |
| `waste_transfer_notice.operator_workplace_id` | integer | 91 | → id |
| `waste_transfer_notice.operator_nif` | string | 91 |  |
| `waste_transfer_notice.operator_name` | string | 91 |  |
| `waste_transfer_notice.operator_vial_code` | string | 91 |  |
| `waste_transfer_notice.operator_nima` | string | 91 |  |
| `waste_transfer_notice.operator_registration_number` | string | 91 |  |
| `waste_transfer_notice.operator_entity_fj_code` | string | 91 |  |
| `waste_transfer_notice.operator_reason_association_code` | string | 91 |  |
| `waste_transfer_notice.operator_type` | string | 91 |  |
| `waste_transfer_notice.operator_address` | string | 91 |  |
| `waste_transfer_notice.operator_municipality` | string | 91 |  |
| `waste_transfer_notice.operator_town_ine_code` | integer | 91 |  |
| `waste_transfer_notice.operator_province` | string | 91 |  |
| `waste_transfer_notice.operator_activity` | string | 91 |  |
| `waste_transfer_notice.operator_province_ine_code` | integer | 91 |  |
| `waste_transfer_notice.operator_postal_code` | string | 91 |  |
| `waste_transfer_notice.operator_phone` | string | 91 |  |
| `waste_transfer_notice.operator_email` | string | 91 |  |
| `waste_transfer_notice.operator_brand_name` | string | 91 |  |
| `waste_transfer_notice.origin_crm_id` | integer | 91 | → id |
| `waste_transfer_notice.origin_workplace_id` | integer | 91 | → id |
| `waste_transfer_notice.origin_nif` | string | 91 |  |
| `waste_transfer_notice.origin_name` | string | 91 |  |
| `waste_transfer_notice.origin_nima` | string | 91 |  |
| `waste_transfer_notice.origin_registration_number` | string | 91 |  |
| `waste_transfer_notice.origin_vial_code` | string | 91 |  |
| `waste_transfer_notice.origin_reason_association_code` | string | 91 |  |
| `waste_transfer_notice.origin_entity_fj_code` | string | 91 |  |
| `waste_transfer_notice.origin_center_type` | string | 91 |  |
| `waste_transfer_notice.origin_activity` | string | 91 |  |
| `waste_transfer_notice.origin_address` | string | 91 |  |
| `waste_transfer_notice.origin_municipality` | string | 91 |  |
| `waste_transfer_notice.origin_town_ine_code` | integer | 91 |  |
| `waste_transfer_notice.origin_province` | string | 91 |  |
| `waste_transfer_notice.origin_province_ine_code` | integer | 91 |  |
| `waste_transfer_notice.origin_postal_code` | string | 91 |  |
| `waste_transfer_notice.origin_phone` | string | 91 |  |
| `waste_transfer_notice.origin_email` | string | 91 |  |
| `waste_transfer_notice.origin_brand_name` | string | 91 |  |
| `waste_transfer_notice.destination_crm_id` | integer | 91 | → id |
| `waste_transfer_notice.destination_workplace_id` | integer | 91.1 | → id |
| `waste_transfer_notice.destination_nif` | string | 91 |  |
| `waste_transfer_notice.destination_name` | string | 91 |  |
| `waste_transfer_notice.destination_nima` | string | 91 |  |
| `waste_transfer_notice.destination_vial_code` | string | 91 |  |
| `waste_transfer_notice.destination_activity` | string | 91 |  |
| `waste_transfer_notice.destination_registration_number` | string | 91 |  |
| `waste_transfer_notice.destination_reason_association_code` | string | 91 |  |
| `waste_transfer_notice.destination_entity_fj_code` | string | 91 |  |
| `waste_transfer_notice.destination_center_type` | string | 91 |  |
| `waste_transfer_notice.destination_address` | string | 91 |  |
| `waste_transfer_notice.destination_municipality` | string | 91 |  |
| `waste_transfer_notice.destination_town_ine_code` | integer | 91 |  |
| `waste_transfer_notice.destination_province` | string | 91 |  |
| `waste_transfer_notice.destination_province_ine_code` | integer | 91 |  |
| `waste_transfer_notice.destination_postal_code` | string | 91 |  |
| `waste_transfer_notice.destination_phone` | string | 91 |  |
| `waste_transfer_notice.destination_email` | string | 91 |  |
| `waste_transfer_notice.destination_brand_name` | string | 91 |  |
| `waste_transfer_notice.notification_file_name` | string | 91.1 |  |
| `waste_transfer_notice.send_expiration_mail` | object | 91 |  |
| `waste_transfer_notice.company_id` | integer | 91 | → id |
| `waste_transfer_notice.createdAt` | date | 91 |  |
| `waste_transfer_notice.updatedAt` | date | 91 |  |
| `waste_transfer_notice.waste_info` | array | 91 |  |
| `destination.id` | integer | 18.1 | → id |
| `destination.empresa_id` | integer | 18.1 | → id |
| `destination.corporate_name` | string | 18.1 |  |
| `destination.client_email` | string | 19.1 |  |
| `destination.brand_name` | string | 18.1 |  |
| `destination.cif_nif` | string | 18.1 |  |
| `destination.address` | string | 18.1 |  |
| `destination.town_ine_code` | integer | 18.1 |  |
| `destination.postal_code` | string | 18.1 |  |
| `destination.country_code` | string | 18.1 |  |
| `destination.province_ine_code` | integer | 18.1 |  |
| `destination.billing_manager` | string | 18.1 |  |
| `destination.comments` | string | 18.1 |  |
| `destination.reason_association_code` | string | 18.1 |  |
| `destination.entity_fj_code` | string | 18.1 |  |
| `destination.vial_code` | string | 18.1 |  |
| `destination.payment_method` | string | 18.1 |  |
| `destination.paymentMonthDay` | null | 100 |  |
| `destination.payment_comments` | string | 18.1 |  |
| `destination.IBAN` | string | 18.1 |  |
| `destination.payment_term` | integer | 18.1 |  |
| `destination.external_id` | null | 100 | → id |
| `destination.is_active` | boolean | 18.1 |  |
| `destination.type` | array | 18.1 |  |
| `destination.worker_id` | null | 100 | → id |
| `destination.libraSendDate` | date | 26.1 |  |
| `destination.extra_external_id` | string | 23.9 | → id |
| `destination.face_accounting_office` | null | 100 |  |
| `destination.face_managing_body` | null | 100 |  |
| `destination.face_processing_unit` | null | 100 |  |
| `destination.invoice_receiver_type` | string | 18.1 |  |
| `destination.faceb2b_receiver_dire_code` | null | 100 |  |
| `destination.updatedAt` | date | 18.1 |  |
| `destination.deletedAt` | null | 100 |  |
| `destination.createdAt` | date | 18.1 |  |
| `destination_workplace.id` | integer | 18.1 | → id |
| `destination_workplace.client_id` | integer | 18.1 | → id |
| `destination_workplace.corporate_name` | string | 18.1 |  |
| `destination_workplace.isActive` | boolean | 18.1 |  |
| `destination_workplace.country_code` | string | 18.1 |  |
| `destination_workplace.cif_nif` | string | 18.1 |  |
| `destination_workplace.address` | string | 18.1 |  |
| `destination_workplace.reason_association_code` | string | 18.1 |  |
| `destination_workplace.entity_fj_code` | string | 18.1 |  |
| `destination_workplace.vial_code` | string | 18.1 |  |
| `destination_workplace.town_ine_code` | integer | 18.1 |  |
| `destination_workplace.postal_code` | string | 18.1 |  |
| `destination_workplace.province_ine_code` | integer | 18.1 |  |
| `destination_workplace.center_manager` | string | 18.1 |  |
| `destination_workplace.phone` | string | 18.1 |  |
| `destination_workplace.email` | string | 18.1 |  |
| `destination_workplace.comments` | string | 18.1 |  |
| `destination_workplace.billing_emails` | array | 99.7 |  |
| `destination_workplace.external_id` | null | 100 | → id |
| `destination_workplace.brand_name` | string | 18.1 |  |
| `destination_workplace.deletedAt` | null | 100 |  |
| `destination_workplace.createdAt` | date | 18.1 |  |
| `destination_workplace.updatedAt` | date | 18.1 |  |
| `destination_workplace.town` | object | 18.1 |  |
| `destination_workplace.province` | object | 18.1 |  |
| `client_file.id` | integer | 99.9 | → id |
| `client_file.fileName` | string | 99.9 |  |
| `client_file.bucket` | string | 99.9 |  |
| `client_file.path` | string | 99.9 |  |
| `client_file.fileSize` | string | 99.9 |  |
| `client_file.uploadDate` | date | 99.9 |  |
| `client_file.mimeType` | string | 100 |  |
| `client_file.provider` | string | 99.9 |  |
| `client_file.updatedAtExternal` | null | 100 |  |
| `client_file.isPrivate` | null | 100 |  |
| `client_file.externalId` | null | 100 | → id |
| `client_file.folderId` | null | 100 | → id |
| `client_file.status` | string | 99.9 |  |
| `client_file.metadataAi` | null | 100 |  |
| `client_file.integrationError` | null | 100 |  |
| `client_file.createdAt` | date | 99.9 |  |
| `client_file.updatedAt` | date | 99.9 |  |

### company

`empresa/25` · HTTP 200 · 1 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `companyId` | integer | 0 | → id |
| `CIF` | string | 0 |  |
| `companyType` | string | 0 |  |
| `name` | string | 0 |  |
| `address` | string | 0 |  |
| `addressNumber` | string | 0 |  |
| `addressOffice` | string | 0 |  |
| `townName` | string | 0 |  |
| `provinceName` | string | 0 |  |
| `postalCode` | string | 0 |  |
| `email` | string | 0 |  |
| `phone` | string | 0 |  |
| `internalProfidataCode` | string | 0 |  |
| `profidigitalId` | integer | 0 | → id |
| `quoteAccount` | string | 0 |  |
| `brandName` | string | 0 |  |
| `logoFileId` | null | 100 | → id |
| `companyManager` | string | 0 |  |
| `reasonAssociationCode` | string | 0 |  |
| `entityFjCode` | string | 0 |  |
| `vialCode` | string | 0 |  |
| `empresaConfigurationId` | string | 0 | → id |
| `townIneCode` | integer | 0 |  |
| `provinceIneCode` | integer | 0 |  |
| `isAssociation` | boolean | 0 |  |
| `parentCompanyId` | null | 100 | → id |
| `externalId` | null | 100 | → id |
| `billingAccountId` | null | 100 | → id |
| `createdAt` | null | 100 |  |
| `updatedAt` | date | 0 |  |
| `deletedAt` | null | 100 |  |
| `logo_file_id` | null | 100 | → id |
| `parent_company_id` | null | 100 | → id |
| `town` | object | 0 |  |
| `town.ine_code` | integer | 0 |  |
| `town.name` | string | 0 |  |
| `town.createdAt` | date | 0 |  |
| `town.updatedAt` | date | 0 |  |
| `province` | object | 0 |  |
| `province.ine_code` | integer | 0 |  |
| `province.name` | string | 0 |  |
| `province.createdAt` | date | 0 |  |
| `province.updatedAt` | date | 0 |  |
| `companyConfiguration` | object | 0 |  |
| `companyConfiguration.id` | string | 0 | → id |
| `companyConfiguration.isVerifactu` | boolean | 0 |  |
| `companyConfiguration.isTicketBai` | boolean | 0 |  |
| `companyConfiguration.isLibra` | boolean | 0 |  |
| `companyConfiguration.libraUrl` | string | 0 |  |
| `companyConfiguration.libraUrlClientAlias` | string | 0 |  |
| `companyConfiguration.libraUrlDeliveryNoteAlias` | string | 0 |  |
| `companyConfiguration.libraClientId` | string | 0 | → id |
| `companyConfiguration.libraClientSecret` | string | 0 |  |
| `companyConfiguration.isAuditing` | boolean | 0 |  |
| `companyConfiguration.isBarcelonaSeaport` | boolean | 0 |  |
| `companyConfiguration.hasCmrAccess` | boolean | 0 |  |
| `companyConfiguration.isSeaport` | boolean | 0 |  |
| `companyConfiguration.driverCanSeeNotAssignedWorkOrders` | boolean | 0 |  |
| `companyConfiguration.IBAN` | null | 100 |  |
| `companyConfiguration.lastInvoiceVerifactu` | null | 100 |  |
| `companyConfiguration.lastInvoiceTicketbai` | null | 100 |  |
| `companyConfiguration.verifactuAuthFileId` | null | 100 | → id |
| `companyConfiguration.sendMailInvoices` | boolean | 0 |  |
| `companyConfiguration.sendMailConsigmentNotes` | boolean | 0 |  |
| `companyConfiguration.customMailSenderEnabled` | boolean | 0 |  |
| `companyConfiguration.isWeighbridgeEnabled` | boolean | 0 |  |
| `companyConfiguration.isWeighbridgeDeliveryNoteEnabled` | boolean | 0 |  |
| `companyConfiguration.weighbridgeBaseUrl` | null | 100 |  |
| `companyConfiguration.weighbridgeApiKey` | null | 100 |  |
| `companyConfiguration.enabledMicrosoftSso` | boolean | 0 |  |
| `companyConfiguration.enabledVehicleUpc` | boolean | 0 |  |
| `companyConfiguration.hasInvoiceReceptionIntegration` | boolean | 0 |  |
| `companyConfiguration.companyId` | integer | 0 | → id |
| `companyConfiguration.lastInvoiceHashId` | null | 100 | → id |
| `companyConfiguration.multipleControlDocument` | boolean | 0 |  |
| `companyConfiguration.createdAt` | date | 0 |  |
| `companyConfiguration.updatedAt` | date | 0 |  |
| `companyConfiguration.verifactuConfig` | object | 0 |  |
| `invoiceConfig` | object | 0 |  |
| `invoiceConfig.id` | integer | 0 | → id |
| `invoiceConfig.invoice_serial` | string | 0 |  |
| `invoiceConfig.rectificative_invoice_serial` | string | 0 |  |
| `invoiceConfig.company_id` | integer | 0 | → id |
| `invoiceConfig.invoiceTemplate` | string | 0 |  |
| `invoiceConfig.isConfirmRequired` | boolean | 0 |  |
| `invoiceConfig.keyVaultSecretName` | null | 100 |  |
| `invoiceConfig.createdAt` | date | 0 |  |
| `invoiceConfig.updatedAt` | date | 0 |  |
| `invoiceConfig.volume` | null | 100 |  |
| `invoiceConfig.book` | null | 100 |  |
| `invoiceConfig.folio` | null | 100 |  |
| `invoiceConfig.page` | null | 100 |  |
| `invoiceConfig.productor_information` | null | 100 |  |
| `invoiceSeries` | array | 0 |  |
| `factorialConfig` | null | 100 |  |

### company_services

`serviciosEmpresa/25` · HTTP 200 · 5 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `startDate` | date | 20 |  |
| `endDate` | date | 20 |  |
| `serviceTypeId` | integer | 0 | → id |
| `companyId` | integer | 0 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `serviceType` | object | 0 |  |
| `serviceType.id` | integer | 0 | → id |
| `serviceType.name` | string | 0 |  |
| `serviceType.createdAt` | null | 100 |  |
| `serviceType.updatedAt` | null | 100 |  |

### company_profidigital

`subservicios/profidigital/empresa/25` · HTTP 200 · 3 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `startDate` | date | 0 |  |
| `endDate` | date | 0 |  |
| `subserviceTypeId` | integer | 0 | → id |
| `companyId` | integer | 0 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `company` | object | 0 |  |
| `company.companyId` | integer | 0 | → id |
| `company.CIF` | string | 0 |  |
| `company.companyType` | string | 0 |  |
| `company.name` | string | 0 |  |
| `company.address` | string | 0 |  |
| `company.addressNumber` | string | 0 |  |
| `company.addressOffice` | string | 0 |  |
| `company.townName` | string | 0 |  |
| `company.provinceName` | string | 0 |  |
| `company.postalCode` | string | 0 |  |
| `company.email` | string | 0 |  |
| `company.phone` | string | 0 |  |
| `company.internalProfidataCode` | string | 0 |  |
| `company.profidigitalId` | integer | 0 | → id |
| `company.quoteAccount` | string | 0 |  |
| `company.brandName` | string | 0 |  |
| `company.logoFileId` | null | 100 | → id |
| `company.companyManager` | string | 0 |  |
| `company.reasonAssociationCode` | string | 0 |  |
| `company.entityFjCode` | string | 0 |  |
| `company.vialCode` | string | 0 |  |
| `company.empresaConfigurationId` | string | 0 | → id |
| `company.townIneCode` | integer | 0 |  |
| `company.provinceIneCode` | integer | 0 |  |
| `company.isAssociation` | boolean | 0 |  |
| `company.parentCompanyId` | null | 100 | → id |
| `company.externalId` | null | 100 | → id |
| `company.billingAccountId` | null | 100 | → id |
| `company.createdAt` | null | 100 |  |
| `company.updatedAt` | date | 0 |  |
| `company.deletedAt` | null | 100 |  |
| `company.logo_file_id` | null | 100 | → id |
| `company.parent_company_id` | null | 100 | → id |
| `subserviceType` | object | 0 |  |
| `subserviceType.id` | integer | 0 | → id |
| `subserviceType.name` | string | 0 |  |
| `subserviceType.serviceTypeId` | integer | 0 | → id |
| `subserviceType.createdAt` | date | 66.7 |  |
| `subserviceType.updatedAt` | date | 66.7 |  |

### invoice_config

`invoice-config/25` · HTTP 200 · 1 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `invoice_serial` | string | 0 |  |
| `rectificative_invoice_serial` | string | 0 |  |
| `company_id` | integer | 0 | → id |
| `invoiceTemplate` | string | 0 |  |
| `isConfirmRequired` | boolean | 0 |  |
| `keyVaultSecretName` | null | 100 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `volume` | null | 100 |  |
| `book` | null | 100 |  |
| `folio` | null | 100 |  |
| `page` | null | 100 |  |
| `productor_information` | null | 100 |  |
| `company` | object | 0 |  |
| `company.companyId` | integer | 0 | → id |
| `company.CIF` | string | 0 |  |
| `company.companyType` | string | 0 |  |
| `company.name` | string | 0 |  |
| `company.address` | string | 0 |  |
| `company.addressNumber` | string | 0 |  |
| `company.addressOffice` | string | 0 |  |
| `company.townName` | string | 0 |  |
| `company.provinceName` | string | 0 |  |
| `company.postalCode` | string | 0 |  |
| `company.email` | string | 0 |  |
| `company.phone` | string | 0 |  |
| `company.internalProfidataCode` | string | 0 |  |
| `company.profidigitalId` | integer | 0 | → id |
| `company.quoteAccount` | string | 0 |  |
| `company.brandName` | string | 0 |  |
| `company.logoFileId` | null | 100 | → id |
| `company.companyManager` | string | 0 |  |
| `company.reasonAssociationCode` | string | 0 |  |
| `company.entityFjCode` | string | 0 |  |
| `company.vialCode` | string | 0 |  |
| `company.empresaConfigurationId` | string | 0 | → id |
| `company.townIneCode` | integer | 0 |  |
| `company.provinceIneCode` | integer | 0 |  |
| `company.isAssociation` | boolean | 0 |  |
| `company.parentCompanyId` | null | 100 | → id |
| `company.externalId` | null | 100 | → id |
| `company.billingAccountId` | null | 100 | → id |
| `company.createdAt` | null | 100 |  |
| `company.updatedAt` | date | 0 |  |
| `company.deletedAt` | null | 100 |  |
| `company.logo_file_id` | null | 100 | → id |
| `company.parent_company_id` | null | 100 | → id |

### waste_management_config

`waste-management-config?companies=25` · HTTP 200 · 1 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `default_nima` | string | 0 |  |
| `default_notice_number` | string | 0 |  |
| `default_document_number` | string | 0 |  |
| `representative_entity` | string | 0 |  |
| `esir_user` | string | 0 |  |
| `esir_password` | string | 0 |  |
| `email` | string | 0 |  |
| `default_operator_crm_id` | integer | 0 | → id |
| `default_operator_workplace_crm_id` | integer | 0 | → id |
| `default_transporter_crm_id` | integer | 0 | → id |
| `default_transporter_workplace_crm_id` | integer | 0 | → id |
| `company_id` | integer | 0 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |

### waste_delivery_note_ids

`waste-delivery-note/get-ids?companies=25` · HTTP 200 · 14365 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `waste_work_order_id` | integer | 0.1 | → id |

### expiration_notification_count

`expiration/active-notification-count?companies=25` · HTTP 200 · 1 registros

Sin campos.

### provinces

`provinces` · HTTP 200 · 52 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `ine_code` | integer | 0 |  |
| `name` | string | 0 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |

### towns_page1

`towns/infinite?page=1` · HTTP 200 · 20 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `ine_code` | integer | 0 |  |
| `name` | string | 0 |  |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |

### clients_sample

`clients/{id} + company-service|items|residue/paginated?clientId={id}` · HTTP 200 · 5 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `empresa_id` | integer | 0 | → id |
| `corporate_name` | string | 0 |  |
| `client_email` | string | 0 |  |
| `brand_name` | string | 0 |  |
| `cif_nif` | string | 0 |  |
| `address` | string | 0 |  |
| `town_ine_code` | integer | 0 |  |
| `postal_code` | string | 0 |  |
| `country_code` | string | 0 |  |
| `province_ine_code` | integer | 0 |  |
| `billing_manager` | string | 0 |  |
| `comments` | string | 0 |  |
| `reason_association_code` | string | 0 |  |
| `entity_fj_code` | string | 0 |  |
| `vial_code` | string | 0 |  |
| `payment_method` | string | 0 |  |
| `paymentMonthDay` | null | 100 |  |
| `payment_comments` | string | 0 |  |
| `IBAN` | string | 0 |  |
| `payment_term` | integer | 0 |  |
| `external_id` | null | 100 | → id |
| `is_active` | boolean | 0 |  |
| `type` | array | 0 |  |
| `worker_id` | null | 100 | → id |
| `libraSendDate` | date | 0 |  |
| `extra_external_id` | string | 0 | → id |
| `face_accounting_office` | null | 100 |  |
| `face_managing_body` | null | 100 |  |
| `face_processing_unit` | null | 100 |  |
| `invoice_receiver_type` | string | 0 |  |
| `faceb2b_receiver_dire_code` | null | 100 |  |
| `updatedAt` | date | 0 |  |
| `deletedAt` | null | 100 |  |
| `createdAt` | date | 0 |  |
| `contact_phones` | array | 0 |  |
| `billing_addresses` | array | 0 |  |
| `billing_emails` | array | 0 |  |
| `contacts` | array | 0 |  |
| `wasteInfo` | object | 0 |  |
| `wasteInfo.id` | integer | 0 | → id |
| `wasteInfo.clientId` | integer | 0 | → id |
| `wasteInfo.nima` | string | 20 |  |
| `wasteInfo.inscriptionNumber` | string | 20 |  |
| `wasteInfo.transferOperatorType` | null | 100 |  |
| `wasteInfo.productionCenterType` | string | 20 |  |
| `wasteInfo.managementCenterType` | null | 100 |  |
| `wasteInfo.transporterType` | null | 100 |  |
| `wasteInfo.economicActivity` | string | 40 |  |
| `wasteInfo.createdAt` | date | 0 |  |
| `wasteInfo.updatedAt` | date | 0 |  |
| `workplaces` | array | 0 |  |
| `town` | object | 0 |  |
| `town.ine_code` | integer | 0 |  |
| `town.name` | string | 0 |  |
| `town.createdAt` | date | 0 |  |
| `town.updatedAt` | date | 0 |  |
| `province` | object | 0 |  |
| `province.ine_code` | integer | 0 |  |
| `province.name` | string | 0 |  |
| `province.createdAt` | date | 0 |  |
| `province.updatedAt` | date | 0 |  |
| `followUps` | array | 0 |  |
| `aditionalDocuments` | array | 0 |  |
| `expirations` | array | 0 |  |
| `companyIds` | array | 0 |  |

### workers_sample

`workers/{id}?allDocuments=true` · HTTP 200 · 5 registros

| Campo | Tipo | % nulos | Relación |
|---|---|---|---|
| `id` | integer | 0 |  |
| `name` | string | 0 |  |
| `surname` | string | 0 |  |
| `fullName` | string | 0 |  |
| `NIF` | string | 0 |  |
| `nationality` | string | 0 |  |
| `birthdate` | date | 40 |  |
| `email` | string | 0 |  |
| `ssoMail` | string | 40 |  |
| `personalEmail` | null | 100 |  |
| `personalPhone` | string | 0 |  |
| `address` | string | 0 |  |
| `addressDetails` | string | 40 |  |
| `postalCode` | string | 40 |  |
| `townIneCode` | integer | 0 |  |
| `provinceIneCode` | integer | 0 |  |
| `companyId` | integer | 0 | → id |
| `registrationDate` | date | 0 |  |
| `companyWorkplaceId` | integer | 40 | → id |
| `vehicleId` | integer | 0 | → id |
| `companyPhone` | string | 0 |  |
| `observations` | string | 0 |  |
| `terminationDate` | null | 100 |  |
| `isActive` | boolean | 0 |  |
| `externalId` | null | 100 | → id |
| `dfmExternalId` | null | 100 | → id |
| `dfmUpdatedAtExternal` | null | 100 |  |
| `extraData` | null | 100 |  |
| `listUnmetRequirements` | array | 0 |  |
| `updatedAtExternal` | null | 100 |  |
| `positionId` | integer | 0 | → id |
| `subpositionId` | null | 100 | → id |
| `photoFileId` | null | 100 | → id |
| `createdAt` | date | 0 |  |
| `updatedAt` | date | 0 |  |
| `workerCompanies` | array | 0 |  |
| `aditionalDocuments` | array | 0 |  |
| `regulatedStudies` | array | 0 |  |
| `certifications` | array | 0 |  |
