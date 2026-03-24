import { Icons } from "@/components/icons"

interface NavItem {
    title: string
    to?: string
    href?: string
    disabled?: boolean
    external?: boolean
    icon?: keyof typeof Icons
    label?: string
}

interface NavItemWithChildren extends NavItem {
    items?: NavItemWithChildren[]
}

export const mainMenu: NavItemWithChildren[] = [
    {
        title: 'Overview',
        to: '',
    },
    {
        title: 'Storage',
        to: 'storage',
    },
    {
        title: 'VMs & Containers',
        to: 'vms-containers',
    },
    {
        title: 'Networks',
        to: 'networks',
    },
    {
        title: 'FinOps',
        to: 'finops',
    },
    {
        title: 'Trends',
        to: 'trends',
    },
    {
        title: 'Settings',
        to: 'settings',
    },
]

export const sideMenu: NavItemWithChildren[] = []
