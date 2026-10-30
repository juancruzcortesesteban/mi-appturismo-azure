import React, { useEffect, useState } from 'react';
import { ChevronRight, Code2, FileCode, Folder, FolderOpen, LockKeyhole, ShieldCheck } from 'lucide-react';
import { fetchSourceTree, SourceTreeNode, SourceTreeResponse } from '../utils/system';
import { UserRole } from '../utils/rbac';

interface CodeViewerProps {
  currentRole: UserRole;
  effectivePermissions?: string[];
}

const DENIED_MESSAGE = 'Acceso denegado: esta sección requiere el rol SuperAdmin o Auditor.';

const FileTreeItem: React.FC<{ node: SourceTreeNode }> = ({ node }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const isDirectory = node.type === 'directory';

  return (
    <li>
      {isDirectory ? (
        <button
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-200 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <ChevronRight
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
          {isExpanded
            ? <FolderOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-400" />
            : <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-400" />}
          <span>{node.name}</span>
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-300">
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
          <FileCode aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400" />
          <span>{node.name}</span>
        </div>
      )}

      {isDirectory && isExpanded && node.children && node.children.length > 0 && (
        <ul className="ml-4 border-l border-white/10 pl-3">
          {node.children.map((child) => (
            <FileTreeItem key={`${node.name}/${child.name}`} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
};

export const CodeViewer: React.FC<CodeViewerProps> = ({
  currentRole,
  effectivePermissions = [],
}) => {
  const canView = effectivePermissions.includes('access_rbac');
  const [sourceTree, setSourceTree] = useState<SourceTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canView) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMessage('');

    fetchSourceTree()
      .then((tree) => {
        if (isMounted) setSourceTree(tree);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar el árbol de código.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => { isMounted = false; };
  }, [canView, reloadKey]);

  if (!canView) {
    return (
      <section
        className="mx-auto my-16 max-w-2xl rounded-2xl border border-red-400/30 bg-[#141b24]/75 p-8 text-center shadow-2xl shadow-black/30 backdrop-blur-xl"
        role="alert"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/10 text-red-300">
          <LockKeyhole className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="font-display text-xl font-bold text-[#F8F6F0]">Arquitectura &amp; Código Fuente</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-300">{DENIED_MESSAGE}</p>
      </section>
    );
  }

  return (
    <>
    <section className="mx-auto my-10 max-w-4xl rounded-2xl border border-purple-400/20 bg-[#141b24]/75 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-purple-400/25 bg-purple-500/10 text-purple-300">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </div>
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-300">
            <Code2 className="h-4 w-4" />
            {currentRole}
          </div>
          <h1 className="font-display text-xl font-bold text-[#F8F6F0]">Arquitectura del Proyecto</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Árbol de directorios y nombres de archivos. No se expone el contenido fuente.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-neutral-400" role="status">Cargando estructura...</p>}
      {!isLoading && errorMessage && (
        <div className="text-sm text-red-300" role="alert">
          {errorMessage}{' '}
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="font-semibold underline underline-offset-2 hover:text-white"
          >
            Reintentar
          </button>
        </div>
      )}
      {!isLoading && sourceTree && (
        <div className="max-h-[32rem] overflow-auto rounded-xl border border-white/10 bg-[#0c1017] p-4">
          <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-sm font-semibold text-[#F8F6F0]">
            <FolderOpen aria-hidden="true" className="h-4 w-4 text-orange-400" />
            <span>{sourceTree.root}</span>
          </div>
          <ul className="space-y-0.5">
            {sourceTree.tree.map((node) => (
              <FileTreeItem key={`${sourceTree.root}/${node.name}`} node={node} />
            ))}
          </ul>
        </div>
      )}
    </section>
    </>
  );
};
