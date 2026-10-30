import React, { FormEvent, useEffect, useState } from 'react';
import {
  ApiPlace,
  createMerchantPlace,
  deleteMerchantPlace,
  fetchMerchantPlaces,
  uploadPlaceImage,
} from '../utils/places';
import {
  Store,
  PlusCircle,
  MapPin,
  CheckCircle,
  Edit,
  Trash2,
  ShieldAlert,
  ArrowRight,
  Mountain,
  Lock,
} from 'lucide-react';

interface MerchantPlace {
  id: number;
  name: string;
  category: string;
  department: string;
  city: string;
  entryFee: number;
  status: 'Verificado' | 'En Revisión';
}

function toMerchantPlace(place: ApiPlace): MerchantPlace {
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    department: place.department,
    city: place.city,
    entryFee: place.entry_fee,
    status: place.is_verified ? 'Verificado' : 'En Revisión',
  };
}

interface MerchantViewProps {
  effectivePermissions?: string[];
  onNavigate: (view: 'index' | 'places' | 'merchant' | 'admin' | 'code') => void;
  onTriggerAlert: (title: string, message: string, isWarning?: boolean) => void;
}

export const MerchantView: React.FC<MerchantViewProps> = ({
  effectivePermissions = [],
  onNavigate,
  onTriggerAlert,
}) => {
  const [places, setPlaces] = useState<MerchantPlace[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);
  const [placesError, setPlacesError] = useState('');
  const [placesReloadKey, setPlacesReloadKey] = useState(0);
  const [isSavingPlace, setIsSavingPlace] = useState(false);
  const [deletingPlaceId, setDeletingPlaceId] = useState<number | null>(null);

  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'Aventura' | 'Cultural' | 'Histórico'>('Aventura');
  const [formDept, setFormDept] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formFee, setFormFee] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formLatitude, setFormLatitude] = useState('');
  const [formLongitude, setFormLongitude] = useState('');
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const canReadPortal = effectivePermissions.includes('access_merchant');
  const isReadOnly = !effectivePermissions.includes('write_operations');

  useEffect(() => {
    if (!canReadPortal) {
      setIsLoadingPlaces(false);
      return;
    }
    let isMounted = true;
    setIsLoadingPlaces(true);
    setPlacesError('');

    fetchMerchantPlaces()
      .then((apiPlaces) => {
        if (isMounted) setPlaces(apiPlaces.map(toMerchantPlace));
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setPlacesError(error instanceof Error ? error.message : 'No se pudieron cargar tus atractivos.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingPlaces(false);
      });

    return () => { isMounted = false; };
  }, [canReadPortal, placesReloadKey]);

  // Verificación de RBAC en Vista
  if (!canReadPortal) {
    return (
      <div className="py-16 max-w-xl mx-auto text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/15 text-red-500 flex items-center justify-center mx-auto border border-red-500/30 shadow-lg">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white font-display">Acceso Denegado (RBAC Guard)</h2>
          <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
            Tu rol actual no tiene permiso para consultar este módulo.
          </p>
        </div>
        <div className="pt-4 flex justify-center gap-3">
          <button
            onClick={() => onNavigate('index')}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#E67E22] hover:bg-[#D35400] transition-colors cursor-pointer"
          >
            Volver a Inicio
          </button>
          <button
            onClick={() => {
              onTriggerAlert('Consejo de Prueba', 'Cambia el selector de rol en la barra superior a "Comerciante" para acceder.', false);
            }}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-neutral-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
          >
            ¿Cómo Acceder?
          </button>
        </div>
      </div>
    );
  }

  const handleCreatePlace = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const latitude = Number(formLatitude);
    const longitude = Number(formLongitude);
    const entryFee = Number(formFee || 0);
    if (
      !formName.trim()
      || !formDept.trim()
      || !formCity.trim()
      || formDesc.trim().length < 10
      || !Number.isFinite(latitude)
      || latitude < -90
      || latitude > 90
      || !Number.isFinite(longitude)
      || longitude < -180
      || longitude > 180
      || !Number.isFinite(entryFee)
      || entryFee < 0
    ) {
      setFormError('Completa los campos requeridos. La descripción debe tener al menos 10 caracteres y las coordenadas y tarifa deben ser válidas.');
      return;
    }

    setIsSavingPlace(true);
    setFormError('');
    try {
      const imageUrl = formImage ? await uploadPlaceImage(formImage) : null;
      const newPlace = await createMerchantPlace({
        name: formName.trim(),
        description: formDesc.trim(),
        category: formCategory,
        department: formDept.trim(),
        city: formCity.trim(),
        latitude,
        longitude,
        entry_fee: entryFee,
        image_url: imageUrl,
      });

      setPlaces((currentPlaces) => [toMerchantPlace(newPlace), ...currentPlaces]);
      setFormName('');
      setFormDept('');
      setFormCity('');
      setFormFee('');
      setFormDesc('');
      setFormLatitude('');
      setFormLongitude('');
      setFormImage(null);
      formElement.reset();
      onTriggerAlert(
        'Atractivo enviado a revisión',
        `"${newPlace.name}" se guardó correctamente y aparecerá en el muro cuando un administrador lo verifique.`,
        false
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el atractivo.';
      setFormError(message);
      onTriggerAlert('No se pudo registrar el atractivo', message, true);
    } finally {
      setIsSavingPlace(false);
    }
  };

  const handleDeletePlace = async (id: number, name: string) => {
    setDeletingPlaceId(id);
    try {
      await deleteMerchantPlace(id);
      setPlaces((currentPlaces) => currentPlaces.filter((place) => place.id !== id));
      onTriggerAlert('Atractivo Eliminado', `Has eliminado "${name}" de tu catálogo.`, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el atractivo.';
      onTriggerAlert('No se pudo eliminar el atractivo', message, true);
    } finally {
      setDeletingPlaceId(null);
    }
  };

  return (
    <div className="py-8 space-y-12">
      {/* Encabezado */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/10">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold text-[#10B981] uppercase tracking-wider mb-2">
            <Store className="w-4 h-4" />
            <span>Panel de Prestador de Servicios Turísticos</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#F8F6F0] font-display">
            Mis Atractivos & Experiencias
          </h1>
          <p className="text-sm text-neutral-400 mt-1 max-w-xl">
            {isReadOnly
              ? 'Consulta de atractivos turísticos con permisos de solo lectura.'
              : 'Como comerciante, únicamente puedes crear y modificar tus propios atractivos. No posees privilegios para alterar configuraciones globales del sistema.'}
          </p>
        </div>

        {!isReadOnly && <button
          onClick={() => {
            document.getElementById('merchant-form-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-[#059669] to-[#047857] rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-md shadow-[#059669]/25 cursor-pointer self-start md:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Publicar Nuevo Atractivo</span>
        </button>}
      </div>

      {/* Tabla de Lugares Propios */}
      <section className="bg-[#141b24]/80 backdrop-blur-md border border-white/10 rounded-[20px] p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2 font-display">
          <MapPin className="w-5 h-5 text-[#10B981]" />
          <span>Catálogo de Atractivos</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-neutral-400 uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Lugar / Atractivo</th>
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4">Ubicación</th>
                <th className="py-3 px-4">Tarifa de Entrada</th>
                <th className="py-3 px-4">Estado</th>
                {!isReadOnly && <th className="py-3 px-4 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoadingPlaces && (
                <tr>
                  <td colSpan={isReadOnly ? 5 : 6} className="py-6 px-4 text-center text-neutral-400">
                    Cargando atractivos desde el servidor...
                  </td>
                </tr>
              )}
              {!isLoadingPlaces && placesError && (
                <tr>
                  <td colSpan={isReadOnly ? 5 : 6} className="py-4 px-4 text-center text-red-300">
                    {placesError}{' '}
                    <button
                      type="button"
                      onClick={() => setPlacesReloadKey((key) => key + 1)}
                      className="font-semibold underline underline-offset-2 hover:text-white"
                    >
                      Reintentar
                    </button>
                  </td>
                </tr>
              )}
              {!isLoadingPlaces && !placesError && places.length === 0 && (
                <tr>
                  <td colSpan={isReadOnly ? 5 : 6} className="py-6 px-4 text-center text-neutral-400">
                    Aún no hay atractivos asociados a esta cuenta.
                  </td>
                </tr>
              )}
              {places.map((place) => (
                <tr key={place.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 px-4 font-semibold text-white">{place.name}</td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#059669]/20 text-[#10B981]">
                      {place.category}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-neutral-300">
                    {place.city}, {place.department}
                  </td>
                  <td className="py-3.5 px-4 font-bold text-white tabular-nums">
                    {place.entryFee > 0 ? `$${place.entryFee.toLocaleString()} COP` : 'Libre'}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                      place.status === 'Verificado' ? 'text-[#10B981]' : 'text-[#D4AF37]'
                    }`}>
                      {place.status === 'Verificado'
                        ? <CheckCircle className="w-3 h-3" />
                        : <ShieldAlert className="w-3 h-3" />}
                      <span>{place.status}</span>
                    </span>
                  </td>
                  {!isReadOnly && <td className="py-3.5 px-4 text-right space-x-2">
                    <button
                      onClick={() => {
                        onTriggerAlert(
                          'Edición Autorizada',
                          `Como titular de "${place.name}", tienes permiso para modificarlo.`,
                          false
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 border border-white/10 transition-colors cursor-pointer"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeletePlace(place.id, place.name)}
                      disabled={deletingPlaceId !== null}
                      className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors cursor-pointer"
                    >
                      {deletingPlaceId === place.id ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Formulario de Creación de Lugar */}
      {!isReadOnly && <section
        id="merchant-form-section"
        className="bg-[#141b24]/80 backdrop-blur-md border border-white/10 rounded-[20px] p-6 lg:p-8 shadow-xl"
      >
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white font-display mb-1">
            Formulario de Registro de Atractivo
          </h2>
          <p className="text-xs text-neutral-400">
            Al registrar un nuevo lugar, FastAPI asociará automáticamente tu identidad de comerciante
            (JWT sub / merchant_id) como propietario único. Los lugares nuevos quedan en revisión hasta
            que un administrador los apruebe.
          </p>
        </div>

        <form onSubmit={handleCreatePlace} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Nombre del Atractivo *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ej: Laguna de Guatavita Sagrada"
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Categoría *</label>
            <select
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as any)}
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors cursor-pointer"
            >
              <option value="Aventura">Aventura & Naturaleza</option>
              <option value="Cultural">Cultural</option>
              <option value="Histórico">Histórico</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Departamento *
            </label>
            <input
              type="text"
              value={formDept}
              onChange={(e) => setFormDept(e.target.value)}
              placeholder="Ej: Cundinamarca"
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Ciudad / Municipio *
            </label>
            <input
              type="text"
              value={formCity}
              onChange={(e) => setFormCity(e.target.value)}
              placeholder="Ej: Sesquilé"
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Latitud *
            </label>
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              value={formLatitude}
              onChange={(e) => setFormLatitude(e.target.value)}
              placeholder="Ej: 4.7110"
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Longitud *
            </label>
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              value={formLongitude}
              onChange={(e) => setFormLongitude(e.target.value)}
              placeholder="Ej: -74.0721"
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Tarifa de Entrada (COP)
            </label>
            <input
              type="number"
              value={formFee}
              onChange={(e) => setFormFee(e.target.value)}
              placeholder="Ej: 22000"
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Identificador de Propietario (RBAC)
            </label>
            <div className="w-full bg-[#0c1017]/50 border border-white/5 rounded-xl px-3.5 py-2.5 text-xs text-neutral-400">
              merchant_id = 2 (Asignación Automática por Servidor)
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Descripción de la Experiencia
            </label>
            <textarea
              rows={3}
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="Detalla los senderos ecológicos, requisitos de vestimenta, guianza..."
              className="w-full bg-[#0c1017] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#10B981] transition-colors"
              minLength={10}
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Imagen del Atractivo (opcional)
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFormImage(event.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-white/10 bg-[#0c1017] px-3.5 py-2.5 text-xs text-neutral-300 file:mr-3 file:rounded-lg file:border-0 file:bg-[#059669]/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#10B981]"
            />
            <p className="mt-1.5 text-[11px] text-neutral-500">
              JPEG, PNG o WebP (máximo 5 MB). Si lo dejas vacío, se asignará una imagen turística automáticamente.
            </p>
          </div>

          {formError && (
            <p className="sm:col-span-2 text-sm text-red-300" role="alert">{formError}</p>
          )}

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingPlace}
              className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-[#059669] to-[#047857] rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-md shadow-[#059669]/25 cursor-pointer"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isSavingPlace ? 'Guardando...' : 'Enviar a Revisión'}</span>
            </button>
          </div>
        </form>
      </section>}
    </div>
  );
};
